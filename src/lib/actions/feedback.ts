"use server";

import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, uid } from "@/lib/db";
import { feedback, feedbackCategories } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/actions";
import { rateLimit } from "@/lib/security/rate-limit";
import { sanitizeUserText } from "@/lib/security/guard";
import { learnFromFeedback } from "@/lib/services/feedback";

const submitSchema = z.object({
  category: z.enum(feedbackCategories),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  text: z.string().trim().min(4).max(4000),
  feature: z.string().trim().max(64).optional(),
  interactionRef: z.string().trim().max(128).optional(),
});

export type SubmitFeedbackResult =
  | { ok: true; id: string; learned: boolean }
  | { ok: false; error: string };

/** Submit profile feedback: validate → store → (maybe) verify+learn. */
export async function submitFeedbackAction(input: z.infer<typeof submitSchema>): Promise<SubmitFeedbackResult> {
  const user = await requireUser();
  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    if (first?.path.includes("text")) return { ok: false, error: "Tell us a little more — a few words at least." };
    return { ok: false, error: "Invalid feedback — check the category and try again." };
  }

  const rl = rateLimit(`feedback:${user.id}`, { limit: 10, windowMs: 10 * 60 * 1000 });
  if (!rl.allowed) return { ok: false, error: "You're sending feedback too quickly — wait a minute and try again." };

  const text = sanitizeUserText(parsed.data.text).slice(0, 4000);

  // Duplicate rapid submission guard: same text within a minute → reuse.
  const recent = await db
    .select({ id: feedback.id, text: feedback.text })
    .from(feedback)
    .where(eq(feedback.userId, user.id))
    .orderBy(desc(feedback.createdAt))
    .limit(3)
    .all();
  const dupe = recent.find((r) => r.text === text);
  if (dupe) return { ok: true, id: dupe.id, learned: false };

  const id = uid();
  const contextJson = JSON.stringify({
    ...(parsed.data.feature ? { feature: parsed.data.feature } : {}),
    ...(parsed.data.interactionRef ? { interactionRef: parsed.data.interactionRef.slice(0, 128) } : {}),
  });
  const now = new Date().toISOString();
  await db
    .insert(feedback)
    .values({
      id,
      userId: user.id,
      category: parsed.data.category,
      rating: parsed.data.rating ?? null,
      text,
      contextJson,
      status: "submitted",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  // Controlled learning: verified AI/Pilot issues only, user-scoped,
  // deterministic (no AI calls). Failures here never fail the submit.
  let learned = false;
  try {
    const verdict = await learnFromFeedback({
      userId: user.id,
      category: parsed.data.category,
      text,
      topicHint: parsed.data.feature,
    });
    await db
      .update(feedback)
      .set({
        status: verdict.learned ? "learned" : "analyzed",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(feedback.id, id))
      .run();
    learned = verdict.learned;
  } catch {
    /* learning is best-effort; the feedback itself is safely stored */
  }

  return { ok: true, id, learned };
}
