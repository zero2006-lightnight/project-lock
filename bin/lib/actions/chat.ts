"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth/actions";
import { respond } from "@/lib/ai/router";
import { rateLimit } from "@/lib/security/rate-limit";
import { sanitizeUserText } from "@/lib/security/guard";
import {
  buildChatContext,
  getOrCreateConversation,
  maybeTitleSession,
  persistMessage,
  recentMessages,
} from "@/lib/services/chat";

/** Per-user chat budget: generous for real study use, bounded for cost. */
const CHAT_LIMIT = { limit: 20, windowMs: 5 * 60 * 1000 };

export async function sendChatMessageAction(message: string) {
  const user = await requireUser();
  const parsed = z.string().min(1).max(2000).safeParse(message.trim());
  if (!parsed.success) return { ok: false as const, error: "Message is empty" };

  // Rate limit before any DB or model work.
  const rl = rateLimit(`chat:${user.id}`, CHAT_LIMIT);
  if (!rl.allowed) {
    const secs = Math.max(1, Math.ceil(rl.retryAfterMs / 1000));
    return {
      ok: false as const,
      error: `You're sending messages too quickly — take a breath and try again in ${secs}s.`,
    };
  }

  // Strip control characters and delimiter spam before the model sees it.
  const clean = sanitizeUserText(parsed.data);

  const conversationId = await getOrCreateConversation(user.id);
  await persistMessage(conversationId, "user", clean);
  await maybeTitleSession(conversationId, clean);

  try {
    const ctx = await buildChatContext(user.id);
    // Recent turns give the model continuity (ChatGPT-style follow-ups).
    const history = (await recentMessages(conversationId, 11))
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(0, -1) // drop the just-persisted user message
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    const reply = await respond(ctx, clean, history);
    await persistMessage(conversationId, "assistant", reply.reply, {
      actions: reply.actions ?? [],
      suggested: reply.suggested ?? [],
    });

    return {
      ok: true as const,
      conversationId,
      message: {
        id: conversationId,
        content: reply.reply,
        meta: { actions: reply.actions ?? [], suggested: reply.suggested ?? [] },
      },
    };
  } catch (err) {
    // Never leave the student staring at an eternal thinking state — surface
    // provider / validation failures as an actionable error instead.
    const detail = err instanceof Error ? err.message.slice(0, 300) : "unknown error";
    return {
      ok: false as const,
      error: `Pilot couldn't complete that request. ${detail}`,
    };
  }
}