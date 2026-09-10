/* ──────────────────────────────────────────────────────────────
   Profile feedback → controlled AI/Pilot improvement.

   STORE → CLASSIFY → (AI-related? VERIFY → LESSON : product store).
   Reuses the Dynamic Error Learning system (error-lessons.ts):
   no second memory store, no AI calls, no background jobs.
   Every lesson is user-scoped; retrieval stays user-scoped.
   Raw feedback NEVER becomes a rule — prevention rules come from
   fixed templates, evidence is capped, injection lines are stripped.
   ────────────────────────────────────────────────────────────── */

import {
  buildPreventionRule,
  classifyErrorType,
  inferRootCause,
  saveOrUpdateLesson,
  verifyCorrection,
  type NewLessonInput,
} from "@/lib/tuning/error-lessons";
import { keywordTermsOf } from "@/lib/tuning/query";
import { retrieveTuningChunks } from "@/lib/tuning/retrieve";
import type { ErrorLessonConfidence, FeedbackCategory } from "@/lib/db/schema";

export type FeedbackRoute = "product" | "ai_improvement";

/** Categories that may describe AI/Pilot behavior worth learning from. */
const AI_CATEGORIES: FeedbackCategory[] = ["ai_answer", "pilot", "tuning", "accuracy"];

export function classifyFeedback(category: FeedbackCategory): FeedbackRoute {
  return AI_CATEGORIES.includes(category) ? "ai_improvement" : "product";
}

/** Strip prompt-injection / instruction lines before any lesson use. */
export function sanitizeForLesson(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(
      (l) =>
        l.length > 0 &&
        !/^(ignore|disregard)\b.{0,40}(previous|prior|above|instructions?)/i.test(l) &&
        !/^(system|assistant|developer)\s*:/i.test(l) &&
        !/<\s*\/?\s*(system|script|instruction)/i.test(l) &&
        !/\b(jailbreak|DAN mode|do anything now)\b/i.test(l),
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export type FeedbackVerdict =
  | { learned: true; lessonId: string; confidence: ErrorLessonConfidence; updated: boolean }
  | { learned: false; reason: string };

/**
 * Verify AI/Pilot feedback against the user's own tuned material and,
 * on sufficient evidence, create/update a user-scoped error lesson.
 * Deterministic — no AI calls. Returns the verdict for status tracking.
 */
export async function learnFromFeedback(input: {
  userId: string;
  category: FeedbackCategory;
  text: string;
  topicHint?: string;
  kbId?: string | null;
}): Promise<FeedbackVerdict> {
  if (classifyFeedback(input.category) !== "ai_improvement") {
    return { learned: false, reason: "Product feedback — stored for analysis, not learned." };
  }
  const clean = sanitizeForLesson(input.text);
  if (clean.length < 12) {
    return { learned: false, reason: "Too little substance to verify." };
  }

  // Verify against this user's tuned passages (never another user's).
  let chunks: { content: string; score: number }[] = [];
  try {
    const r = await retrieveTuningChunks(input.userId, input.kbId ?? null, clean.slice(0, 2000), 6);
    chunks = r.chunks;
  } catch {
    chunks = [];
  }

  const errorType = classifyErrorType({ correction: clean });
  const { confidence, evidence } = verifyCorrection({ correction: clean, chunks, errorType });
  if (confidence !== "high" && confidence !== "medium") {
    // Genuine uncertainty stays OUT of the steering memory.
    return { learned: false, reason: `Insufficient evidence (${confidence}).` };
  }

  const topic = (input.topicHint ?? "").slice(0, 120) || null;
  const lesson: NewLessonInput = {
    kbId: input.kbId ?? null,
    subjectId: null,
    topic,
    errorType,
    mistakeSummary: clean.slice(0, 500),
    rootCause: inferRootCause(errorType, chunks.length > 0),
    correctApproach: "Follow the prevention rule below for similar future requests.",
    preventionRule: buildPreventionRule(errorType, topic ?? "", clean),
    evidence: `${evidence} Source: profile feedback.`,
    origin: "feedback",
    confidence,
    keywords: keywordTermsOf(clean.toLowerCase()).slice(0, 12),
  };
  const { lesson: row, updated } = await saveOrUpdateLesson(input.userId, lesson);
  return { learned: true, lessonId: row.id, confidence, updated };
}
