"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, uid } from "@/lib/db";
import { assessmentAttempts, quizAttempts, subjects } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/actions";
import { rateLimit } from "@/lib/security/rate-limit";
import { AiSchemaError } from "@/lib/ai/types";
import {
  generateQuizSet,
  gradeQuiz,
  materialHash,
  normalizeConfig,
  strongTopicsFromGrading,
  validateMaterial,
  weakTopicsFromGrading,
  type GradedAnswer,
} from "@/lib/assess/quiz";
import {
  evaluateSummaryImage,
  evaluateSummaryText,
  generateSummaryPrompt,
  transcribeMaterialImage,
  validateAnswer,
  validateImage,
} from "@/lib/assess/summary";

/* Focused actions — one responsibility each. Correctness is always
   computed server-side from the trusted stored questions. */

const GEN_LIMIT = { limit: 8, windowMs: 10 * 60 * 1000 };
const ANSWER_LIMIT = { limit: 20, windowMs: 10 * 60 * 1000 };

function friendly(err: unknown, fallback: string): string {
  if (err instanceof AiSchemaError) return err.message;
  const msg = err instanceof Error ? err.message : "";
  if (/rate limit|429/i.test(msg)) return "The AI service is busy — wait a moment and try again.";
  if (/timeout|timed out|fetch failed|network/i.test(msg)) return "The AI service did not respond in time. Try again.";
  return fallback;
}

async function ownedSubject(userId: string, subjectId?: string): Promise<string | null> {
  if (!subjectId) return null;
  const own = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(and(eq(subjects.id, subjectId), eq(subjects.userId, userId)))
    .limit(1)
    .all();
  return own.length ? subjectId : null;
}

async function ownedAttempt(userId: string, attemptId: string, mode: "quiz" | "summary") {
  const rows = await db
    .select()
    .from(assessmentAttempts)
    .where(and(eq(assessmentAttempts.id, attemptId), eq(assessmentAttempts.userId, userId), eq(assessmentAttempts.mode, mode)))
    .limit(1)
    .all();
  return rows[0] ?? null;
}

/* ── Quiz ── */

export async function generateQuizAction(input: {
  material: string;
  subjectId?: string;
  count?: unknown;
  difficulty?: unknown;
  topicFocus?: unknown;
}) {
  const user = await requireUser();
  const rl = rateLimit(`assess-quiz:${user.id}`, GEN_LIMIT);
  if (!rl.allowed) return { ok: false as const, error: "Quiz generation is rate-limited — try again in a few minutes." };
  const checked = validateMaterial(input.material);
  if (!checked.ok) return { ok: false as const, error: checked.error };
  const config = normalizeConfig({ count: input.count, difficulty: input.difficulty, topicFocus: input.topicFocus });
  try {
    const set = await generateQuizSet(checked.material, config);
    const id = uid();
    const now = new Date().toISOString();
    await db.insert(assessmentAttempts).values({
      id,
      userId: user.id,
      subjectId: await ownedSubject(user.id, input.subjectId),
      mode: "quiz",
      status: "active",
      materialExcerpt: checked.material.slice(0, 4000),
      materialHash: materialHash(checked.material),
      promptJson: JSON.stringify({ questions: set.questions, config }),
      resultJson: JSON.stringify({ answers: [] as GradedAnswer[] }),
      createdAt: now,
      updatedAt: now,
    });
    // Correct answers never leave the server until each question is checked.
    const safe = set.questions.map((q) => ({
      id: q.id,
      topic: q.topic,
      question: q.question,
      options: q.options,
      difficulty: q.difficulty,
    }));
    return { ok: true as const, attemptId: id, questions: safe };
  } catch (err) {
    return { ok: false as const, error: friendly(err, "Could not generate the quiz. Try again.") };
  }
}

const CheckSchema = z.object({
  attemptId: z.string().min(1).max(64),
  questionId: z.string().min(1).max(40),
  selected: z.number().int().min(0).max(3),
});

export async function checkQuizAnswerAction(input: { attemptId: string; questionId: string; selected: number }) {
  const user = await requireUser();
  const rl = rateLimit(`assess-answer:${user.id}`, ANSWER_LIMIT);
  if (!rl.allowed) return { ok: false as const, error: "Slow down a little — try again in a few seconds." };
  const parsed = CheckSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid answer submission." };
  const attempt = await ownedAttempt(user.id, parsed.data.attemptId, "quiz");
  if (!attempt || attempt.status !== "active") return { ok: false as const, error: "Quiz not found or already finished." };

  let stored: { questions: { id: string; topic: string; correctOptionIndex: number; explanation: string; wrongWhy?: string }[] };
  try {
    stored = JSON.parse(attempt.promptJson) as typeof stored;
  } catch {
    return { ok: false as const, error: "Quiz data is corrupted — generate a fresh quiz." };
  }
  const q = stored.questions.find((x) => x.id === parsed.data.questionId);
  if (!q) return { ok: false as const, error: "Question not found in this quiz." };

  const correct = parsed.data.selected === q.correctOptionIndex;
  let result: { answers: GradedAnswer[] };
  try {
    result = JSON.parse(attempt.resultJson) as typeof result;
    if (!Array.isArray(result.answers)) result = { answers: [] };
  } catch {
    result = { answers: [] };
  }
  const entry: GradedAnswer = {
    questionId: q.id,
    topic: q.topic,
    selected: parsed.data.selected,
    correct,
    correctOptionIndex: q.correctOptionIndex,
    explanation: q.explanation,
    wrongWhy: q.wrongWhy ?? "",
  };
  result.answers = [...result.answers.filter((a) => a.questionId !== q.id), entry];
  await db
    .update(assessmentAttempts)
    .set({ resultJson: JSON.stringify(result), updatedAt: new Date().toISOString() })
    .where(eq(assessmentAttempts.id, attempt.id))
    .run();

  return {
    ok: true as const,
    correct,
    // Explanation is released only after the student commits an answer.
    correctOptionIndex: q.correctOptionIndex,
    explanation: q.explanation,
    wrongWhy: q.wrongWhy ?? "",
  };
}

export async function finishQuizAction(attemptId: string) {
  const user = await requireUser();
  const attempt = await ownedAttempt(user.id, attemptId, "quiz");
  if (!attempt) return { ok: false as const, error: "Quiz not found." };
  let stored: { questions: Parameters<typeof gradeQuiz>[0] };
  let result: { answers: { questionId: string; selected: number | null }[] };
  try {
    stored = JSON.parse(attempt.promptJson) as typeof stored;
    result = JSON.parse(attempt.resultJson) as typeof result;
  } catch {
    return { ok: false as const, error: "Quiz data is corrupted — generate a fresh quiz." };
  }
  const byId = new Map(result.answers.map((a) => [a.questionId, a.selected ?? null]));
  const graded = gradeQuiz(stored.questions, stored.questions.map((q) => byId.get(q.id) ?? null));
  const weak = weakTopicsFromGrading(graded.answers);
  const strong = strongTopicsFromGrading(graded.answers);
  const now = new Date().toISOString();
  await db
    .update(assessmentAttempts)
    .set({ status: "graded", resultJson: JSON.stringify({ answers: graded.answers }), score: graded.scorePercent, updatedAt: now })
    .where(eq(assessmentAttempts.id, attempt.id))
    .run();
  // Reuse the existing quiz_attempts ledger for progress/analytics.
  await db.insert(quizAttempts).values({
    id: uid(),
    userId: user.id,
    subjectId: attempt.subjectId,
    source: "assess",
    questionCount: stored.questions.length,
    correctCount: graded.correctCount,
    createdAt: now,
  });
  return {
    ok: true as const,
    answers: graded.answers,
    correctCount: graded.correctCount,
    total: stored.questions.length,
    scorePercent: graded.scorePercent,
    weakTopics: weak,
    strongTopics: strong,
  };
}

/* ── Summary ── */

export async function generateSummaryPromptAction(input: { material: string; subjectId?: string }) {
  const user = await requireUser();
  const rl = rateLimit(`assess-sum:${user.id}`, GEN_LIMIT);
  if (!rl.allowed) return { ok: false as const, error: "Prompt generation is rate-limited — try again in a few minutes." };
  const checked = validateMaterial(input.material);
  if (!checked.ok) return { ok: false as const, error: checked.error };
  try {
    const prompt = await generateSummaryPrompt(checked.material);
    const id = uid();
    const now = new Date().toISOString();
    await db.insert(assessmentAttempts).values({
      id,
      userId: user.id,
      subjectId: await ownedSubject(user.id, input.subjectId),
      mode: "summary",
      status: "active",
      materialExcerpt: checked.material.slice(0, 4000),
      materialHash: materialHash(checked.material),
      promptJson: JSON.stringify(prompt),
      resultJson: JSON.stringify({}),
      createdAt: now,
      updatedAt: now,
    });
    return { ok: true as const, attemptId: id, prompt: prompt.prompt, keyPoints: prompt.keyPoints };
  } catch (err) {
    return { ok: false as const, error: friendly(err, "Could not create the question. Try again.") };
  }
}

export async function evaluateSummaryTextAction(input: { attemptId: string; answer: string }) {
  const user = await requireUser();
  const rl = rateLimit(`assess-eval:${user.id}`, ANSWER_LIMIT);
  if (!rl.allowed) return { ok: false as const, error: "Evaluation is rate-limited — try again shortly." };
  const attempt = await ownedAttempt(user.id, input.attemptId, "summary");
  if (!attempt || attempt.status !== "active") return { ok: false as const, error: "Practice session not found or already evaluated." };
  const checked = validateAnswer(input.answer);
  if (!checked.ok) return { ok: false as const, error: checked.error };
  // Ground truth comes from the stored attempt — never from the client.
  try {
    const prompt = JSON.parse(attempt.promptJson) as { prompt: string };
    const evaluation = await evaluateSummaryText(attempt.materialExcerpt, prompt.prompt, checked.answer);
    await db
      .update(assessmentAttempts)
      .set({
        status: "graded",
        resultJson: JSON.stringify({ answer: checked.answer.slice(0, 4000), evaluation, image: false }),
        score: evaluation.score,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(assessmentAttempts.id, attempt.id))
      .run();
    return { ok: true as const, evaluation };
  } catch (err) {
    return { ok: false as const, error: friendly(err, "Could not evaluate the answer. Try again.") };
  }
}

export async function evaluateSummaryImageAction(input: { attemptId: string; imageBase64: string; mimeType: string }) {
  const user = await requireUser();
  const rl = rateLimit(`assess-eval:${user.id}`, ANSWER_LIMIT);
  if (!rl.allowed) return { ok: false as const, error: "Evaluation is rate-limited — try again shortly." };
  const attempt = await ownedAttempt(user.id, input.attemptId, "summary");
  if (!attempt || attempt.status !== "active") return { ok: false as const, error: "Practice session not found or already evaluated." };
  const sizeBytes = Math.floor((input.imageBase64.length * 3) / 4);
  const img = validateImage(input.mimeType, sizeBytes);
  if (!img.ok) return { ok: false as const, error: img.error };
  try {
    const prompt = JSON.parse(attempt.promptJson) as { prompt: string };
    // The image is processed in-memory only — never written to the database.
    const evaluation = await evaluateSummaryImage(attempt.materialExcerpt, prompt.prompt, input.imageBase64, input.mimeType);
    await db
      .update(assessmentAttempts)
      .set({
        status: "graded",
        resultJson: JSON.stringify({ evaluation, image: true, imageMime: input.mimeType }),
        score: evaluation.score,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(assessmentAttempts.id, attempt.id))
      .run();
    return { ok: true as const, evaluation };
  } catch (err) {
    return { ok: false as const, error: friendly(err, "Could not analyze the image. Try again, or type the answer instead.") };
  }
}

/** Transcribe an image into study-material text (material input option B). */
export async function transcribeMaterialImageAction(input: { imageBase64: string; mimeType: string }) {
  const user = await requireUser();
  const rl = rateLimit(`assess-transcribe:${user.id}`, GEN_LIMIT);
  if (!rl.allowed) return { ok: false as const, error: "Transcription is rate-limited — try again in a few minutes." };
  void user;
  const sizeBytes = Math.floor((input.imageBase64.length * 3) / 4);
  const img = validateImage(input.mimeType, sizeBytes);
  if (!img.ok) return { ok: false as const, error: img.error };
  try {
    const text = await transcribeMaterialImage(input.imageBase64, input.mimeType);
    return { ok: true as const, text };
  } catch (err) {
    return { ok: false as const, error: friendly(err, "Could not read that image. Try a clearer photo, or paste the text.") };
  }
}
