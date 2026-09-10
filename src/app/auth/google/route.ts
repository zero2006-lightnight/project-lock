import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { googleConfig } from "@/lib/auth/google";

export const dynamic = "force-dynamic";

/** GET /auth/google — start the OAuth dance. */
export async function GET(request: Request) {
  const { clientId, redirectUri, configured } = googleConfig();
  const base = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  if (!configured) {
    const url = new URL("/login", base);
    url.searchParams.set("error", "not_configured");
    return NextResponse.redirect(url);
  }

  // State protects against CSRF on the callback. Short-lived, httpOnly.
  // Secure only when actually serving HTTPS — Secure cookies over plain HTTP
  // on non-localhost hosts are silently dropped by the browser.
  const state = randomBytes(24).toString("hex");
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const isHttps = forwardedProto ? forwardedProto === "https" : new URL(request.url).protocol === "https:";
  const cookieStore = await cookies();
  cookieStore.set("sp_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps,
    path: "/",
    maxAge: 600, // 10 minutes
  });

  const params = new URLSearchParams({
    client_id: clientId!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
    access_type: "online",
  });
  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}
