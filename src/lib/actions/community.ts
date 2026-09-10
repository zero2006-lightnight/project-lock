"use server";

import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, uid } from "@/lib/db";
import {
  communities,
  communityAnswers,
  communityInvites,
  communityMaterials,
  communityMemberships,
  communityQuestions,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/actions";
import { rateLimit } from "@/lib/security/rate-limit";
import { sanitizeUserText } from "@/lib/security/guard";
import { logSecurityEvent } from "@/lib/security/events";
import { verifyUpload } from "@/lib/security/uploads";
import {
  isAdmin,
  isMember,
  memberCount,
  pseudonym,
  requireMembership,
} from "@/lib/services/community";



const hashInvite = (token: string) => createHash("sha256").update(token).digest("hex");

/* ── Communities ─────────────────────────────────────────────── */

export async function createCommunityAction(input: { name: string; description?: string; subject?: string }) {
  const user = await requireUser();
  const parsed = z
    .object({ name: z.string().trim().min(3).max(80), description: z.string().trim().max(500).optional(), subject: z.string().trim().max(80).optional() })
    .safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Give the community a name (3–80 characters)." };
  const rl = rateLimit(`community-create:${user.id}`, { limit: 5, windowMs: 60 * 60 * 1000 });
  if (!rl.allowed) return { ok: false as const, error: "Too many communities created — try again later." };

  const id = uid();
  const now = new Date().toISOString();
  await db.insert(communities).values({
    id,
    name: sanitizeUserText(parsed.data.name, 80),
    description: sanitizeUserText(parsed.data.description ?? "", 500),
    subject: parsed.data.subject?.trim() ? sanitizeUserText(parsed.data.subject, 80) : null,
    createdBy: user.id,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(communityMemberships).values({ id: uid(), communityId: id, userId: user.id, role: "admin", createdAt: now });
  return { ok: true as const, id };
}

export type MyCommunity = { id: string; name: string; description: string; subject: string | null; role: "admin" | "member"; memberCount: number };

export async function listMyCommunitiesAction(): Promise<MyCommunity[]> {
  const user = await requireUser();
  const rows = await db
    .select({ communityId: communityMemberships.communityId, role: communityMemberships.role })
    .from(communityMemberships)
    .where(eq(communityMemberships.userId, user.id))
    .all();
  const out: MyCommunity[] = [];
  for (const r of rows) {
    const c = (await db.select().from(communities).where(eq(communities.id, r.communityId)).limit(1).all())[0];
    if (!c || c.status !== "active") continue;
    out.push({ id: c.id, name: c.name, description: c.description ?? "", subject: c.subject, role: r.role as "admin" | "member", memberCount: await memberCount(c.id) });
  }
  return out;
}

export async function getCommunityAction(communityId: string) {
  const user = await requireUser();
  const m = await requireMembership(communityId, user.id);
  if (!m) {
    logSecurityEvent({ type: "csrf_blocked", userId: user.id, detail: `community denied:${communityId.slice(0, 12)}` });
    return { ok: false as const, error: "Community not found." };
  }
  const c = (await db.select().from(communities).where(eq(communities.id, communityId)).limit(1).all())[0]!;
  return {
    ok: true as const,
    community: { id: c.id, name: c.name, description: c.description ?? "", subject: c.subject, role: m.role, memberCount: await memberCount(c.id) },
  };
}

export async function deleteCommunityAction(communityId: string, confirmName: string) {
  const user = await requireUser();
  const m = await requireMembership(communityId, user.id);
  if (!m || !isAdmin(m)) return { ok: false as const, error: "Only admins can delete a community." };
  const c = (await db.select().from(communities).where(eq(communities.id, communityId)).limit(1).all())[0];
  if (!c || c.name.trim().toLowerCase() !== confirmName.trim().toLowerCase()) {
    return { ok: false as const, error: "Type the community name exactly to confirm deletion." };
  }
  // Cascade removes memberships, invites, materials, questions, answers.
  // User accounts and private data are untouched (separate tables).
  await db.delete(communities).where(eq(communities.id, communityId)).run();
  return { ok: true as const };
}

/* ── Invitations ─────────────────────────────────────────────── */

export async function generateInviteAction(communityId: string, opts?: { expiresInDays?: number; maxUses?: number }) {
  const user = await requireUser();
  const m = await requireMembership(communityId, user.id);
  if (!m || !isAdmin(m)) return { ok: false as const, error: "Only admins can invite." };
  const token = randomBytes(24).toString("hex");
  const now = new Date().toISOString();
  await db.insert(communityInvites).values({
    id: uid(),
    communityId,
    tokenHash: hashInvite(token),
    createdBy: user.id,
    expiresAt: opts?.expiresInDays ? new Date(Date.now() + opts.expiresInDays * 86400000).toISOString() : null,
    maxUses: Math.max(0, Math.min(1000, opts?.maxUses ?? 0)),
    useCount: 0,
    revokedAt: null,
    createdAt: now,
  });
  return { ok: true as const, token };
}

export async function listInvitesAction(communityId: string) {
  const user = await requireUser();
  const m = await requireMembership(communityId, user.id);
  if (!m || !isAdmin(m)) return { ok: false as const, error: "Only admins can view invitations." };
  const rows = await db.select().from(communityInvites).where(eq(communityInvites.communityId, communityId)).orderBy(desc(communityInvites.createdAt)).limit(20).all();
  return {
    ok: true as const,
    invites: rows.map((r) => ({ id: r.id, createdAt: r.createdAt, expiresAt: r.expiresAt, maxUses: r.maxUses, useCount: r.useCount, revoked: r.revokedAt !== null })),
  };
}

export async function revokeInviteAction(inviteId: string) {
  const user = await requireUser();
  const inv = (await db.select().from(communityInvites).where(eq(communityInvites.id, inviteId)).limit(1).all())[0];
  if (!inv) return { ok: false as const, error: "Invitation not found." };
  const m = await requireMembership(inv.communityId, user.id);
  if (!m || !isAdmin(m)) return { ok: false as const, error: "Only admins can revoke invitations." };
  await db.update(communityInvites).set({ revokedAt: new Date().toISOString() }).where(eq(communityInvites.id, inviteId)).run();
  return { ok: true as const };
}

export async function previewInviteAction(token: string) {
  const user = await requireUser();
  const inv = (await db.select().from(communityInvites).where(eq(communityInvites.tokenHash, hashInvite(token.trim()))).limit(1).all())[0];
  if (!inv || inv.revokedAt) return { ok: false as const, error: "This invitation link is invalid or was revoked." };
  if (inv.expiresAt && inv.expiresAt < new Date().toISOString()) return { ok: false as const, error: "This invitation link has expired." };
  if (inv.maxUses > 0 && inv.useCount >= inv.maxUses) return { ok: false as const, error: "This invitation link has already been used." };
  const c = (await db.select().from(communities).where(eq(communities.id, inv.communityId)).limit(1).all())[0];
  if (!c || c.status !== "active") return { ok: false as const, error: "This community is no longer available." };
  return { ok: true as const, community: { id: c.id, name: c.name, description: c.description ?? "", memberCount: await memberCount(c.id) }, alreadyMember: await isMember(c.id, user.id) };
}

export async function acceptInviteAction(token: string) {
  const user = await requireUser();
  const rl = rateLimit(`invite-accept:${user.id}`, { limit: 10, windowMs: 60 * 60 * 1000 });
  if (!rl.allowed) return { ok: false as const, error: "Too many attempts — try again later." };
  const inv = (await db.select().from(communityInvites).where(eq(communityInvites.tokenHash, hashInvite(token.trim()))).limit(1).all())[0];
  if (!inv || inv.revokedAt) return { ok: false as const, error: "This invitation link is invalid or was revoked." };
  if (inv.expiresAt && inv.expiresAt < new Date().toISOString()) return { ok: false as const, error: "This invitation link has expired." };
  if (inv.maxUses > 0 && inv.useCount >= inv.maxUses) return { ok: false as const, error: "This invitation link has already been used." };
  const c = (await db.select().from(communities).where(eq(communities.id, inv.communityId)).limit(1).all())[0];
  if (!c || c.status !== "active") return { ok: false as const, error: "This community is no longer available." };
  if (await isMember(c.id, user.id)) return { ok: true as const, communityId: c.id };
  await db.insert(communityMemberships).values({ id: uid(), communityId: c.id, userId: user.id, role: "member", createdAt: new Date().toISOString() });
  await db.update(communityInvites).set({ useCount: inv.useCount + 1 }).where(eq(communityInvites.id, inv.id)).run();
  return { ok: true as const, communityId: c.id };
}

/* ── Members (admin; pseudonymous) ───────────────────────────── */

export async function listMembersAdminAction(communityId: string) {
  const user = await requireUser();
  const m = await requireMembership(communityId, user.id);
  if (!m || !isAdmin(m)) return { ok: false as const, error: "Only admins can view members." };
  const rows = await db.select().from(communityMemberships).where(eq(communityMemberships.communityId, communityId)).all();
  return {
    ok: true as const,
    members: rows.map((r) => ({ membershipId: r.id, label: r.userId === user.id ? "You (admin)" : pseudonym(communityId, r.userId), role: r.role, self: r.userId === user.id })),
  };
}

export async function removeMemberAction(communityId: string, membershipId: string) {
  const user = await requireUser();
  const m = await requireMembership(communityId, user.id);
  if (!m || !isAdmin(m)) return { ok: false as const, error: "Only admins can remove members." };
  const target = (await db.select().from(communityMemberships).where(eq(communityMemberships.id, membershipId)).limit(1).all())[0];
  if (!target || target.communityId !== communityId) return { ok: false as const, error: "Member not found." };
  if (target.userId === user.id) return { ok: false as const, error: "You can't remove yourself." };
  await db.delete(communityMemberships).where(eq(communityMemberships.id, membershipId)).run();
  return { ok: true as const };
}

/* ── Materials ─────────────────────────────────────────────────
   Uploads travel ONLY via POST /api/community/materials (multipart —
   the real 200 MB path; server actions cap bodies at 100 MB). */

export type CommunityMaterialDTO = { id: string; fileName: string; mimeType: string; sizeBytes: number; createdAt: string | null; by: string };

export async function listMaterialsAction(communityId: string, filter?: "pdf" | "word" | "image") {
  const user = await requireUser();
  const m = await requireMembership(communityId, user.id);
  if (!m) return { ok: false as const, error: "Community not found." };
  const rows = await db
    .select()
    .from(communityMaterials)
    .where(and(eq(communityMaterials.communityId, communityId), eq(communityMaterials.status, "active")))
    .orderBy(desc(communityMaterials.createdAt))
    .limit(100)
    .all();
  const mine = user.id;
  return {
    ok: true as const,
    isAdmin: isAdmin(m),
    materials: rows
      .filter((r) => {
        if (!filter) return true;
        if (filter === "pdf") return r.mimeType.includes("pdf") || r.fileName.toLowerCase().endsWith(".pdf");
        if (filter === "word") return /word|offic|docx?$/i.test(r.mimeType) || /\.(docx?)$/i.test(r.fileName);
        return /png|jpe?g|webp|gif|image/i.test(r.mimeType) || /\.(png|jpe?g|webp|gif)$/i.test(r.fileName);
      })
      .map((r): CommunityMaterialDTO & { own: boolean } => ({
        id: r.id,
        fileName: r.fileName,
        mimeType: r.mimeType,
        sizeBytes: r.sizeBytes,
        createdAt: r.createdAt,
        by: "Community Member",
        own: r.uploadedBy === mine,
      })),
  };
}

export async function deleteMaterialAction(materialId: string) {
  const user = await requireUser();
  const row = (await db.select().from(communityMaterials).where(eq(communityMaterials.id, materialId)).limit(1).all())[0];
  if (!row) return { ok: false as const, error: "Material not found." };
  const m = await requireMembership(row.communityId, user.id);
  if (!m) return { ok: false as const, error: "Community not found." };
  if (row.uploadedBy !== user.id && !isAdmin(m)) return { ok: false as const, error: "You can only remove your own uploads." };
  await db.update(communityMaterials).set({ status: "removed" }).where(eq(communityMaterials.id, materialId)).run();
  return { ok: true as const };
}

/* ── Q&A ─────────────────────────────────────────────────────── */

const questionSchema = z.object({
  communityId: z.string().min(1).max(64),
  title: z.string().trim().min(4).max(140),
  content: z.string().trim().max(4000).optional(),
  subject: z.string().trim().max(80).optional(),
});

export async function askQuestionAction(input: z.infer<typeof questionSchema>) {
  const user = await requireUser();
  const parsed = questionSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Give the question a clear title (4+ characters)." };
  const m = await requireMembership(parsed.data.communityId, user.id);
  if (!m) return { ok: false as const, error: "Community not found." };
  const rl = rateLimit(`cqa:${user.id}`, { limit: 20, windowMs: 10 * 60 * 1000 });
  if (!rl.allowed) return { ok: false as const, error: "You're posting too quickly — wait a moment." };
  const now = new Date().toISOString();
  const id = uid();
  await db.insert(communityQuestions).values({
    id,
    communityId: parsed.data.communityId,
    authorId: user.id,
    title: sanitizeUserText(parsed.data.title, 140),
    content: sanitizeUserText(parsed.data.content ?? "", 4000),
    subject: parsed.data.subject?.trim() ? sanitizeUserText(parsed.data.subject, 80) : null,
    status: "open",
    createdAt: now,
    updatedAt: now,
  });
  return { ok: true as const, id };
}

export type QuestionDTO = {
  id: string; title: string; content: string; subject: string | null; status: string;
  by: string; own: boolean; answerCount: number; createdAt: string | null;
};

export async function listQuestionsAction(communityId: string) {
  const user = await requireUser();
  const m = await requireMembership(communityId, user.id);
  if (!m) return { ok: false as const, error: "Community not found." };
  const rows = await db.select().from(communityQuestions).where(eq(communityQuestions.communityId, communityId)).orderBy(desc(communityQuestions.createdAt)).limit(100).all();
  const questions: QuestionDTO[] = [];
  for (const q of rows) {
    const answers = await db.select({ id: communityAnswers.id }).from(communityAnswers).where(and(eq(communityAnswers.questionId, q.id), eq(communityAnswers.status, "active"))).all();
    questions.push({
      id: q.id, title: q.title, content: q.content, subject: q.subject, status: q.status,
      by: "Anonymous Student", own: q.authorId === user.id, answerCount: answers.length, createdAt: q.createdAt,
    });
  }
  return { ok: true as const, isAdmin: isAdmin(m), questions };
}

export type AnswerDTO = { id: string; content: string; by: string; own: boolean; helpful: boolean; createdAt: string | null };

export async function listAnswersAction(questionId: string) {
  const user = await requireUser();
  const q = (await db.select().from(communityQuestions).where(eq(communityQuestions.id, questionId)).limit(1).all())[0];
  if (!q) return { ok: false as const, error: "Question not found." };
  const m = await requireMembership(q.communityId, user.id);
  if (!m) return { ok: false as const, error: "Community not found." };
  const rows = await db.select().from(communityAnswers).where(and(eq(communityAnswers.questionId, questionId), eq(communityAnswers.status, "active"))).all();
  return {
    ok: true as const,
    question: { id: q.id, title: q.title, content: q.content, status: q.status, own: q.authorId === user.id },
    isAdmin: isAdmin(m),
    answers: rows.map((a): AnswerDTO => ({ id: a.id, content: a.content, by: "Community Member", own: a.authorId === user.id, helpful: a.helpful ?? false, createdAt: a.createdAt })),
  };
}

export async function answerQuestionAction(input: { questionId: string; content: string }) {
  const user = await requireUser();
  const parsed = z.object({ questionId: z.string().min(1).max(64), content: z.string().trim().min(2).max(4000) }).safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Write an answer first." };
  const q = (await db.select().from(communityQuestions).where(eq(communityQuestions.id, parsed.data.questionId)).limit(1).all())[0];
  if (!q) return { ok: false as const, error: "Question not found." };
  const m = await requireMembership(q.communityId, user.id);
  if (!m) return { ok: false as const, error: "Community not found." };
  const rl = rateLimit(`cqa:${user.id}`, { limit: 20, windowMs: 10 * 60 * 1000 });
  if (!rl.allowed) return { ok: false as const, error: "You're posting too quickly — wait a moment." };
  const id = uid();
  await db.insert(communityAnswers).values({ id, questionId: q.id, authorId: user.id, content: sanitizeUserText(parsed.data.content, 4000), helpful: false, status: "active", createdAt: new Date().toISOString() });
  if (q.status === "open") {
    await db.update(communityQuestions).set({ status: "answered", updatedAt: new Date().toISOString() }).where(eq(communityQuestions.id, q.id)).run();
  }
  return { ok: true as const, id };
}

export async function markHelpfulAction(answerId: string) {
  const user = await requireUser();
  const a = (await db.select().from(communityAnswers).where(eq(communityAnswers.id, answerId)).limit(1).all())[0];
  if (!a) return { ok: false as const, error: "Answer not found." };
  const q = (await db.select().from(communityQuestions).where(eq(communityQuestions.id, a.questionId)).limit(1).all())[0]!;
  const m = await requireMembership(q.communityId, user.id);
  if (!m) return { ok: false as const, error: "Community not found." };
  if (q.authorId !== user.id && !isAdmin(m)) return { ok: false as const, error: "Only the asker can mark helpful." };
  await db.update(communityAnswers).set({ helpful: true }).where(eq(communityAnswers.id, answerId)).run();
  return { ok: true as const };
}

export async function resolveQuestionAction(questionId: string) {
  const user = await requireUser();
  const q = (await db.select().from(communityQuestions).where(eq(communityQuestions.id, questionId)).limit(1).all())[0];
  if (!q) return { ok: false as const, error: "Question not found." };
  const m = await requireMembership(q.communityId, user.id);
  if (!m) return { ok: false as const, error: "Community not found." };
  if (q.authorId !== user.id && !isAdmin(m)) return { ok: false as const, error: "Only the asker or an admin can resolve." };
  await db.update(communityQuestions).set({ status: "resolved", updatedAt: new Date().toISOString() }).where(eq(communityQuestions.id, questionId)).run();
  return { ok: true as const };
}

export async function moderateQuestionAction(questionId: string, remove: boolean) {
  const user = await requireUser();
  const q = (await db.select().from(communityQuestions).where(eq(communityQuestions.id, questionId)).limit(1).all())[0];
  if (!q) return { ok: false as const, error: "Question not found." };
  const m = await requireMembership(q.communityId, user.id);
  if (!m || !isAdmin(m)) return { ok: false as const, error: "Only admins can moderate." };
  if (remove) {
    await db.delete(communityQuestions).where(eq(communityQuestions.id, questionId)).run(); // cascade removes answers
  } else {
    await db.update(communityQuestions).set({ status: "open", updatedAt: new Date().toISOString() }).where(eq(communityQuestions.id, questionId)).run();
  }
  return { ok: true as const };
}

export async function moderateAnswerAction(answerId: string) {
  const user = await requireUser();
  const a = (await db.select().from(communityAnswers).where(eq(communityAnswers.id, answerId)).limit(1).all())[0];
  if (!a) return { ok: false as const, error: "Answer not found." };
  const q = (await db.select().from(communityQuestions).where(eq(communityQuestions.id, a.questionId)).limit(1).all())[0]!;
  const m = await requireMembership(q.communityId, user.id);
  if (!m || !isAdmin(m)) return { ok: false as const, error: "Only admins can moderate." };
  await db.update(communityAnswers).set({ status: "removed" }).where(eq(communityAnswers.id, answerId)).run();
  return { ok: true as const };
}


