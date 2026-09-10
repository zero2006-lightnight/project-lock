"use server";

import { redirect } from "next/navigation";
import { and, eq, lte, or } from "drizzle-orm";
import { z } from "zod";
import { headers } from "next/headers";
import { db, uid } from "@/lib/db";
import { profiles, sessions, settings, users } from "@/lib/db/schema";
import { hashPassword, verifyPassword } from "./password";
import { createSession, destroySession, getSessionUser } from "./session";
import { rateLimit } from "@/lib/security/rate-limit";
import { logSecurityEvent } from "@/lib/security/events";
import { clientIpFromHeaders, retryMinutes } from "@/lib/security/request-key";
import { closeActiveSession } from "@/lib/services/chat";

/**
 * NAT-friendly brute-force limits (PL-013): the user may share one LAN IP,
 * so the login key includes the email (per-account lockout) and the IP
 * cap is generous. Rejected attempts never consume budget (limiter
 * semantics), so a burst of typos can't lock anyone out for long.
 */
const LOGIN_EMAIL_LIMIT = { limit: 5, windowMs: 15 * 60_000 }; // 5 per email / 15 min
const LOGIN_IP_LIMIT = { limit: 30, windowMs: 15 * 60_000 }; // 30 per IP / 15 min
const SIGNUP_IP_LIMIT = { limit: 5, windowMs: 60 * 60_000 }; // 5 per IP / hour

/** Shared guard for login/signup. Returns an AuthState error when blocked. */
async function authRateLimit(
  kind: "login" | "signup",
  email: string,
): Promise<AuthState> {
  const h = await headers();
  const ip = clientIpFromHeaders(h);

  if (kind === "login") {
    const perEmail = rateLimit(`login:e:${email.toLowerCase()}`, LOGIN_EMAIL_LIMIT);
    if (!perEmail.allowed) {
      logSecurityEvent({ type: "login_rate_limited", ip, detail: "per-account" });
      return {
        error: `Too many sign-in attempts for this account. Try again in ${retryMinutes(perEmail.retryAfterMs)} minute(s).`,
      };
    }
    const perIp = rateLimit(`login:ip:${ip}`, LOGIN_IP_LIMIT);
    if (!perIp.allowed) {
      logSecurityEvent({ type: "login_rate_limited", ip, detail: "per-network" });
      return {
        error: `Too many sign-in attempts from this network. Try again in ${retryMinutes(perIp.retryAfterMs)} minute(s).`,
      };
    }
    return undefined;
  }

  const perIp = rateLimit(`signup:ip:${ip}`, SIGNUP_IP_LIMIT);
  if (!perIp.allowed) {
    logSecurityEvent({ type: "signup_rate_limited", ip });
    return {
      error: `Too many accounts created from this network. Try again in ${retryMinutes(perIp.retryAfterMs)} minute(s).`,
    };
  }
  return undefined;
}

/** Remove this user's expired sessions (bounded rotation hygiene). */
async function purgeExpiredSessions(userId: string): Promise<void> {
  try {
    const gone = await db
      .delete(sessions)
      .where(and(eq(sessions.userId, userId), lte(sessions.expiresAt, new Date().toISOString())))
      .run();
    void gone;
  } catch {
    /* cleanup is best-effort; login must never fail on it */
  }
}

const credentialsSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1, "Name is required").max(80).optional(),
});

export type AuthState = { error?: string; fieldErrors?: Record<string, string[]> } | undefined;

export async function signupAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    name: formData.get("name"),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const { email, password, name } = parsed.data;

  const limited = await authRateLimit("signup", email);
  if (limited) return limited;

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1).all();
  if (existing.length) {
    return { error: "An account with this email already exists. Try signing in." };
  }

  const userId = uid();
  const displayName = name?.trim() || email.split("@")[0].replace(/[._-]+/g, " ");

  await db.insert(users).values({
    id: userId,
    email,
    name: displayName,
    passwordHash: hashPassword(password),
    onboarded: false,
  });
  await db.insert(profiles).values({ userId });
  await db.insert(settings).values({ userId });

  await createSession(userId);
  redirect("/onboarding");
}

export async function loginAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = credentialsSchema.pick({ email: true, password: true }).safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const { email, password } = parsed.data;

  const limited = await authRateLimit("login", email);
  if (limited) return limited;

  const row = await db
    .select()
    .from(users)
    .where(or(eq(users.email, email), eq(users.email, email.toLowerCase())))
    .limit(1)
    .all();

  if (!row.length || !row[0].passwordHash || !verifyPassword(password, row[0].passwordHash)) {
    logSecurityEvent({ type: "login_failure", ip: clientIpFromHeaders(await headers()) });
    return { error: "Incorrect email or password." };
  }

  await purgeExpiredSessions(row[0].id);
  await createSession(row[0].id);
  logSecurityEvent({ type: "login_success", userId: row[0].id });
  redirect("/app");
}

export async function logoutAction(): Promise<void> {
  const user = await currentUser();
  if (user) {
    // Wrap up the chat session so it appears in the student's history.
    await closeActiveSession(user.id);
  }
  await destroySession();
  redirect("/");
}

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export async function currentUser() {
  return getSessionUser();
}
