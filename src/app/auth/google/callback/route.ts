import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db, uid } from "@/lib/db";
import { profiles, settings, users } from "@/lib/db/schema";
import { createSession } from "@/lib/auth/session";
import { googleConfig } from "@/lib/auth/google";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIpFromHeaders, retryMinutes } from "@/lib/security/request-key";

export const dynamic = "force-dynamic";

type GoogleUserInfo = {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
};

function fail(base: string, error: string) {
  const url = new URL("/login", base);
  url.searchParams.set("error", error);
  return NextResponse.redirect(url);
}

/** GET /auth/google/callback — Google redirects here after consent. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const { clientId, clientSecret, redirectUri, configured } = googleConfig();
  if (!configured) return fail(base, "not_configured");

  // Rate-limit the callback (PL-013): it triggers two outbound calls plus a
  // DB write. IP-keyed only — the email isn't known until Google verifies it.
  const oauthLimit = rateLimit(`oauth:ip:${clientIpFromHeaders(request.headers)}`, {
    limit: 10,
    windowMs: 15 * 60_000,
  });
  if (!oauthLimit.allowed) {
    return fail(base, `google_rate:${retryMinutes(oauthLimit.retryAfterMs)}`);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return fail(base, "google_denied");

  // Verify state (CSRF guard), then consume it.
  const cookieStore = await cookies();
  const saved = cookieStore.get("sp_oauth_state")?.value;
  cookieStore.delete("sp_oauth_state");
  if (!saved || saved !== state) return fail(base, "google_state");

  // Exchange the authorization code for tokens.
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId!,
      client_secret: clientSecret!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) return fail(base, "google_token");
  const { access_token: accessToken } = (await tokenRes.json()) as { access_token?: string };
  if (!accessToken) return fail(base, "google_token");

  // Fetch the verified Google profile.
  const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!infoRes.ok) return fail(base, "google_token");
  const info = (await infoRes.json()) as GoogleUserInfo;
  if (!info.email || info.email_verified === false) return fail(base, "google_email");

  const email = info.email.trim().toLowerCase();
  const now = new Date().toISOString();
  const displayName = info.name?.trim() || email.split("@")[0].replace(/[._-]+/g, " ");

  // Upsert by email so signing in with Google on an existing account just logs in.
  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1).all();
  let userId: string;
  let onboarded = false;
  if (existing.length) {
    const row = existing[0];
    userId = row.id;
    onboarded = row.onboarded;
    await db
      .update(users)
      .set({
        name: row.name === email.split("@")[0] ? displayName : row.name,
        image: info.picture ?? row.image,
        updatedAt: now,
      })
      .where(eq(users.id, row.id))
      .run();
  } else {
    userId = uid();
    await db.insert(users).values({
      id: userId,
      email,
      name: displayName,
      passwordHash: null,
      image: info.picture ?? null,
      onboarded: false,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(profiles).values({ userId, updatedAt: now });
    await db.insert(settings).values({ userId, updatedAt: now });
  }

  await createSession(userId);
  return NextResponse.redirect(new URL(onboarded ? "/app" : "/onboarding", base));
}
