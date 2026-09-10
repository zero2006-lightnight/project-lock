import { cookies, headers } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { db, uid } from "@/lib/db";
import { sessions, users } from "@/lib/db/schema";

export const SESSION_COOKIE = "sp_session";
const SESSION_DAYS = 30;

/**
 * Whether cookies should be marked Secure for the current request.
 * Secure cookies are REJECTED by browsers over plain HTTP on non-localhost
 * addresses (e.g. LAN IPs like 192.168.56.1), so we derive the flag from the
 * actual request protocol instead of NODE_ENV. Behind a proxy, x-forwarded-proto wins.
 */
export async function isHttpsRequest(): Promise<boolean> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  return proto === "https";
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db.insert(sessions).values({ id: uid(), userId, tokenHash: hashToken(token), expiresAt });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: await isHttpsRequest(),
    path: "/",
    expires: new Date(expiresAt),
  });
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token))).run();
    cookieStore.delete(SESSION_COOKIE);
  }
}

export async function getSessionUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const now = new Date().toISOString();
  const rows = await db
    .select({
      user: users,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, now)))
    .limit(1)
    .all();

  if (!rows.length) return null;
  return rows[0].user;
}

export type SessionUser = NonNullable<Awaited<ReturnType<typeof getSessionUser>>>;
