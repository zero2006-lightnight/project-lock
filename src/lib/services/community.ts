/* ──────────────────────────────────────────────────────────────
   Learning Community Hub — access control + anonymity helpers.

   Every operation verifies server-side: authenticated → member →
   (admin for moderation). Identity never leaves the server: members
   see counts and deterministic pseudonyms ("Student #A72") derived
   from a hash — no names, emails, or raw IDs are ever exposed.
   ────────────────────────────────────────────────────────────── */

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { communities, communityMemberships, type CommunityRole } from "@/lib/db/schema";

export type Membership = { communityId: string; userId: string; role: CommunityRole } | null;

/** Maximum shared file size — 200 MB. */
export const MAX_COMMUNITY_BYTES = 200 * 1024 * 1024;

/** Server-side membership lookup. Null = not a member (deny). */
export async function getMembership(communityId: string, userId: string): Promise<Membership> {
  const rows = await db
    .select({ communityId: communityMemberships.communityId, userId: communityMemberships.userId, role: communityMemberships.role })
    .from(communityMemberships)
    .where(and(eq(communityMemberships.communityId, communityId), eq(communityMemberships.userId, userId)))
    .limit(1)
    .all();
  const r = rows[0];
  if (!r) return null;
  return { communityId: r.communityId, userId: r.userId, role: r.role as CommunityRole };
}

export async function requireMembership(communityId: string, userId: string): Promise<Membership> {
  // Closed communities deny everyone except... closed = no access at all.
  const c = await db.select({ status: communities.status }).from(communities).where(eq(communities.id, communityId)).limit(1).all();
  if (!c.length || c[0].status !== "active") return null;
  return getMembership(communityId, userId);
}

export function isAdmin(m: Membership): boolean {
  return m?.role === "admin";
}

/** Deterministic, non-reversible display name. Same user+community → same label. */
export function pseudonym(communityId: string, userId: string): string {
  const h = createHash("sha256").update(`${communityId}:${userId}`).digest("hex").toUpperCase();
  return `Student #${h.slice(0, 3)}`;
}

export async function memberCount(communityId: string): Promise<number> {
  const rows = await db
    .select({ id: communityMemberships.id })
    .from(communityMemberships)
    .where(eq(communityMemberships.communityId, communityId))
    .all();
  return rows.length;
}

/** Signed direct-invite check: is this user already in this community? */
export async function isMember(communityId: string, userId: string): Promise<boolean> {
  return (await getMembership(communityId, userId)) !== null;
}
