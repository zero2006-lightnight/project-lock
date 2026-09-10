import { NextRequest } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth/actions";
import { respond, isLlmIntent, detectIntent } from "@/lib/ai/router";
import { getAiProvider } from "@/lib/ai/provider";
import { llmChatParams } from "@/lib/ai/router";
import type { AiReply } from "@/lib/ai/types";
import { rateLimit } from "@/lib/security/rate-limit";
import { isSameOriginRequest } from "@/lib/security/origin";
import { logSecurityEvent } from "@/lib/security/events";
import { sanitizeUserText } from "@/lib/security/guard";
import {
  buildChatContext,
  getOrCreateConversation,
  maybeTitleSession,
  persistMessage,
  recentMessages,
} from "@/lib/services/chat";

/** Per-user chat budget — identical to the server-action path. */
const CHAT_LIMIT = { limit: 20, windowMs: 5 * 60 * 1000 };

/**
 * SSE frame helpers. The client treats any "delta" as appendable text and
 * "done" as the authoritative final record (it carries the validated
 * meta that was persisted — the client never trusts the raw stream).
 */
function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) {
    logSecurityEvent({ type: "csrf_blocked", detail: "POST /api/chat" });
    return new Response(JSON.stringify({ error: "Cross-origin requests are not allowed." }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  const user = await currentUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "Not signed in" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let message = "";
  try {
    const body = (await req.json()) as { message?: unknown };
    const parsed = z.string().min(1).max(2000).safeParse(typeof body.message === "string" ? body.message.trim() : "");
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "Message is empty" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    message = parsed.data;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rl = rateLimit(`chat:${user.id}`, CHAT_LIMIT);
  if (!rl.allowed) {
    logSecurityEvent({ type: "chat_rate_limited", userId: user.id });
    const secs = Math.max(1, Math.ceil(rl.retryAfterMs / 1000));
    return new Response(
      JSON.stringify({ error: `You're sending messages too quickly — take a breath and try again in ${secs}s.` }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
  }

  const clean = sanitizeUserText(message);
  const conversationId = await getOrCreateConversation(user.id);
  await persistMessage(conversationId, "user", clean);
  await maybeTitleSession(conversationId, clean);

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(sse(event, data)));
      const emit = (text: string) => {
        if (text) send("delta", { t: text });
      };

      try {
        const ctx = await buildChatContext(user.id);
        const history = (await recentMessages(conversationId, 11))
          .filter((m) => m.role === "user" || m.role === "assistant")
          .slice(0, -1) // drop the just-persisted user message
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

        if (!isLlmIntent(clean)) {
          // Deterministic intents are instant — frame as a single chunk so the
          // client's rendering path is identical for every reply.
          const reply = await respond(ctx, clean, history);
          emit(reply.reply);
          await persistMessage(conversationId, "assistant", reply.reply, {
            actions: reply.actions ?? [],
            suggested: reply.suggested ?? [],
          });
          send("done", {
            conversationId,
            reply: reply.reply,
            actions: reply.actions ?? [],
            suggested: reply.suggested ?? [],
          });
          controller.close();
          return;
        }

        // LLM intents: true token streaming, with the same retry/fallback
        // contract as the server-action path.
        const provider = getAiProvider();
        if (!provider.available() || !provider.stream) {
          const reply: AiReply = await respond(ctx, clean, history);
          emit(reply.reply);
          await persistMessage(conversationId, "assistant", reply.reply, {
            actions: reply.actions ?? [],
            suggested: reply.suggested ?? [],
          });
          send("done", {
            conversationId,
            reply: reply.reply,
            actions: reply.actions ?? [],
            suggested: reply.suggested ?? [],
          });
          controller.close();
          return;
        }

        const params = await llmChatParams(ctx, clean, detectIntent(clean), history, "text");
        let full = "";
        try {
          full = await provider.stream(
            params.system,
            params.user,
            { temperature: params.temperature, maxTokens: params.maxTokens },
            (chunk) => {
              full += chunk;
              send("delta", { t: chunk });
            },
          );
        } catch {
          full = "";
        }

        if (!full.trim()) {
          // Stream failed or came back empty — deterministic fallback keeps
          // the conversation alive (same philosophy as localFallback).
          const reply: AiReply = await respond(ctx, clean, history);
          emit(reply.reply);
          await persistMessage(conversationId, "assistant", reply.reply, {
            actions: reply.actions ?? [],
            suggested: reply.suggested ?? [],
          });
          send("done", {
            conversationId,
            reply: reply.reply,
            actions: reply.actions ?? [],
            suggested: reply.suggested ?? [],
          });
          controller.close();
          return;
        }

        emit(full);
        await persistMessage(conversationId, "assistant", full, { actions: [], suggested: [] });
        send("done", { conversationId, reply: full, actions: [], suggested: [] });
        controller.close();
      } catch (err) {
        // Any unexpected failure still ends the stream cleanly.
        const detail = err instanceof Error ? err.message.slice(0, 200) : "unknown error";
        send("error", { message: `Pilot couldn't complete that request. ${detail}` });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
