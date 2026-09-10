"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { chatConversations } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/actions";
import { closeActiveSession, getOrCreateSession, chatHistoryForView } from "@/lib/services/chat";
import { revalidatePath } from "next/cache";

/** Start a brand-new chat session (wraps up the current one). */
export async function newChatSessionAction() {
  const user = await requireUser();
  await closeActiveSession(user.id);
  const id = await getOrCreateSession(user.id);
  revalidatePath("/app/chat");
  return { ok: true as const, conversationId: id };
}

/** Open a past session from the history list. */
export async function openChatSessionAction(conversationId: string) {
  const user = await requireUser();
  const own = await db
    .select({ id: chatConversations.id, endedAt: chatConversations.endedAt })
    .from(chatConversations)
    .where(and(eq(chatConversations.id, conversationId), eq(chatConversations.userId, user.id)))
    .limit(1)
    .all();
  if (!own.length) return { ok: false as const, error: "Session not found." };

  // Opening a past session closes the current one (single active session).
  if (!own[0].endedAt) return { ok: true as const, conversationId };
  await closeActiveSession(user.id);
  // Reopen the chosen past session as the active one.
  await db
    .update(chatConversations)
    .set({ endedAt: null, updatedAt: new Date().toISOString() })
    .where(eq(chatConversations.id, conversationId))
    .run();
  revalidatePath("/app/chat");
  return { ok: true as const, conversationId };
}

export type SessionMessageMeta = {
  actions?: { label: string; href: string }[];
  suggested?: string[];
} | null;

/** Full message history for a session (used when switching). */
export async function sessionMessagesAction(conversationId: string) {
  const user = await requireUser();
  const own = await db
    .select({ id: chatConversations.id })
    .from(chatConversations)
    .where(and(eq(chatConversations.id, conversationId), eq(chatConversations.userId, user.id)))
    .limit(1)
    .all();
  if (!own.length) return { ok: false as const, error: "Session not found." };
  const history = await chatHistoryForView(conversationId);
  return {
    ok: true as const,
    messages: history.map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      content: m.content,
      meta: (m.meta ?? null) as SessionMessageMeta,
    })),
  };
}
