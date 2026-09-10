/* ──────────────────────────────────────────────────────────────
   Dynamic Error Learning & Mistake Prevention — controlled Error
   Memory + retrieval + prevention layer.

   NOT self-training: no model weights, no global prompts, no
   background jobs, no extra AI calls on the hot path. Lessons are
   concise prevention rules scoped by userId FIRST then kbId/subject,
   stored in the existing SQLite DB, ranked with the same deterministic
   local hashed-vector scheme as knowledgeChunks (no second vector DB).

   Flow: DETECT → VERIFY → EXTRACT → DEDUPE → STORE → RETRIEVE → APPLY
   ────────────────────────────────────────────────────────────── */

import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db, uid } from "@/lib/db";
import {
  tuningErrorLessons,
  type ErrorLessonConfidence,
  type ErrorLessonStatus,
  type ErrorLessonType,
  type TuningErrorLesson,
} from "@/lib/db/schema";
import { cosine, localEmbed, parseEmbedding } from "./embed";
import { keywordTermsOf } from "./query";
import type { RetrievedChunk } from "./retrieve";

export const MAX_LESSONS_PER_QUERY = 3;
export const MAX_RULE_CHARS = 280;
export const MAX_FIELD_CHARS = 500;
/** Minimum cosine similarity for a lesson to be considered relevant. */
export const LESSON_RELEVANCE_THRESHOLD = 0.08;
/** Cosine similarity at/above which a candidate is a duplicate of an existing lesson. */
export const LESSON_DUPE_THRESHOLD = 0.5;
export const LESSON_DUPE_KEYWORD_JACCARD = 0.6;

export const ACTIVE_STATUSES: ErrorLessonStatus[] = ["active", "low_priority"];

const CONFIDENCE_WEIGHT: Record<ErrorLessonConfidence, number> = {
  high: 1,
  medium: 0.8,
  low: 0.5,
  unverified: 0.25,
};

const cap = (s: string, n: number) => s.replace(/\s+/g, " ").trim().slice(0, n);

/* ── STEP 3: detection ─────────────────────────────────────────── */

const CORRECTION_RES = [
  /\b(that('s| is)? (wrong|incorrect|false|not right|off))\b/i,
  /\bno[,.]?\s+(the )?correct\b/i,
  /\b(actually|correction|mistake|you (missed|ignored|forgot))\b/i,
  /\b(should (have|be)|supposed to be|uploaded material says|my (notes|pdf|slides?) says?)\b/i,
  /\b(needs? correction|wrong answer|not what (i|my))\b/i,
];

/** Heuristic: does this message carry a potential error lesson? Never a verdict — verification decides. */
export function detectCorrectionIntent(text: string): boolean {
  if (!text || text.trim().length < 8) return false;
  return CORRECTION_RES.some((re) => re.test(text));
}

/** Small practical error taxonomy → prevention strategy. */
export function classifyErrorType(input: {
  query?: string;
  correction?: string;
  technicalSignal?: string;
}): ErrorLessonType {
  const t = `${input.technicalSignal ?? ""} ${input.correction ?? ""} ${input.query ?? ""}`.toLowerCase();
  if (/\b(json|schema|structure|format|markdown table|bullet|heading)\b/.test(t)) return "format_error";
  if (/\b(pars(e|ing)|scan(ned)? pdf|ocr|extract|unreadable)\b/.test(t)) return "parsing_error";
  if (/\b(payload|endpoint|tool|workflow|timeout|retry|rate[- ]limit)\b/.test(t)) return "workflow_error";
  if (/\b(prefer|terminology|wording|style|concise|detailed|example style)\b/.test(t)) return "user_preference_error";
  if (/\b(ignor(ed|e)|uploaded|tuned (material|pdf)|source|my notes|slides?)\b/.test(t)) return "source_priority_error";
  if (/\b(not retriev|no passage|missing context|thin coverage|didn'?t find)\b/.test(t)) return "retrieval_error";
  if (/\b(step|logic|reasoning|calculation|derivation|assum(e|ption))\b/.test(t)) return "reasoning_error";
  if (/\b(ambiguous|clarif|what do you mean|which (unit|topic))\b/.test(t)) return "context_error";
  return "factual_error";
}

export function inferRootCause(errorType: ErrorLessonType, chunksAvailable: boolean): string {
  switch (errorType) {
    case "source_priority_error":
      return "General knowledge overrode the user's uploaded tuned material.";
    case "retrieval_error":
      return chunksAvailable ? "Wrong source retrieved for this topic." : "Relevant tuned context was missing at query time.";
    case "format_error":
      return "Incorrect output format for the requested structure.";
    case "parsing_error":
      return "Parsing failure on the source document.";
    case "user_preference_error":
      return "User's stated format/terminology preference was not applied.";
    case "reasoning_error":
      return "Incorrect assumption or reasoning step in the answer.";
    case "context_error":
      return "Ambiguous request resolved against the wrong context.";
    case "workflow_error":
    case "tool_failure":
      return "Incorrect tool/workflow path for this request.";
    default:
      return "Answer did not match the verified tuned source.";
  }
}

export function buildPreventionRule(errorType: ErrorLessonType, topicHint: string, correction: string): string {
  const topic = topicHint ? ` for ${cap(topicHint, 60)}` : " for this topic";
  switch (errorType) {
    case "source_priority_error":
      return cap(`Retrieve and prioritize the uploaded tuned material${topic} before relying on general knowledge.`, MAX_RULE_CHARS);
    case "retrieval_error":
      return cap(`Retrieve the relevant tuned passages${topic} first; if coverage is thin, say so instead of guessing.`, MAX_RULE_CHARS);
    case "format_error":
      return cap(`Apply the requested response structure${topic}: ${cap(correction, 120)}`, MAX_RULE_CHARS);
    case "user_preference_error":
      return cap(`Follow the user's preferred wording/format${topic}: ${cap(correction, 120)}`, MAX_RULE_CHARS);
    case "reasoning_error":
      return cap(`Work step-by-step from the tuned passages${topic} and state assumptions explicitly.`, MAX_RULE_CHARS);
    default:
      return cap(`Ground the answer in the tuned passages${topic}; quote briefly and never invent what they don't support.`, MAX_RULE_CHARS);
  }
}

/* ── STEP 5: verification (deterministic, no extra AI calls) ───── */

function keywordOverlap(a: string[], b: Set<string>): number {
  if (!a.length) return 0;
  let hits = 0;
  for (const w of a) if (b.has(w)) hits++;
  return hits / a.length;
}

/**
 * Verify a user correction against currently retrieved tuned chunks.
 * Preferred order: tuned material → existing context → verified lessons
 * → (general reasoning = capped at low/unverified). Never trusts blindly.
 */
export function verifyCorrection(input: {
  correction: string;
  chunks: Pick<RetrievedChunk, "content">[];
  errorType: ErrorLessonType;
}): { confidence: ErrorLessonConfidence; evidence: string } {
  const correction = cap(input.correction, MAX_FIELD_CHARS);
  if (!correction) return { confidence: "unverified", evidence: "Empty correction." };
  const chunkText = input.chunks.map((c) => c.content).join("\n").toLowerCase();
  if (!chunkText.trim()) {
    // No tuned evidence to check against — structural/technical claims can
    // still reach low/medium, factual claims stay unverified.
    const technical: ErrorLessonType[] = ["format_error", "parsing_error", "workflow_error", "tool_failure"];
    return technical.includes(input.errorType)
      ? { confidence: "low", evidence: "No tuned passages available; technical claim held as low-confidence." }
      : { confidence: "unverified", evidence: "No tuned passages available to verify against." };
  }
  const chunkWords = new Set(chunkText.replace(/[^a-z0-9+# ]/g, " ").split(/\s+/).filter((w) => w.length >= 4));
  const correctionKeys = keywordTermsOf(correction.toLowerCase());
  const overlap = keywordOverlap(correctionKeys, chunkWords);
  if (overlap >= 0.5) return { confidence: "high", evidence: `Correction terms match tuned passages (${Math.round(overlap * 100)}% keyword overlap).` };
  if (overlap >= 0.25) return { confidence: "medium", evidence: `Correction partially matches tuned passages (${Math.round(overlap * 100)}% keyword overlap).` };
  if (overlap >= 0.1) return { confidence: "low", evidence: `Weak match to tuned passages (${Math.round(overlap * 100)}% keyword overlap).` };
  return { confidence: "unverified", evidence: "Correction conflicts with (or is absent from) the retrieved tuned passages." };
}

/* ── STEP 6: dedupe + strengthening (pure) ─────────────────────── */

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  return inter / (sa.size + sb.size - inter || 1);
}

export type LessonCandidate = {
  embedding: number[];
  keywords: string[];
};

export function findDuplicateLesson(
  existing: { id: string; embedding: number[]; keywords: string[] }[],
  candidate: LessonCandidate,
): string | null {
  for (const e of existing) {
    if (e.embedding.length && candidate.embedding.length) {
      if (cosine(e.embedding, candidate.embedding) >= LESSON_DUPE_THRESHOLD) return e.id;
    }
    if (jaccard(e.keywords, candidate.keywords) >= LESSON_DUPE_KEYWORD_JACCARD) return e.id;
  }
  return null;
}

/** Confidence only strengthens on verified evidence — never on repetition alone. */
export function strengthenedConfidence(
  current: ErrorLessonConfidence,
  verification: ErrorLessonConfidence,
): ErrorLessonConfidence {
  const order: ErrorLessonConfidence[] = ["unverified", "low", "medium", "high"];
  const ci = order.indexOf(current);
  const vi = order.indexOf(verification);
  if (vi > ci && vi >= order.indexOf("medium")) return order[Math.min(ci + 1, 3)]!;
  return current;
}

/* ── STEP 7: retrieval (scoped, budgeted) ──────────────────────── */

export type RankedLesson = TuningErrorLesson & { relevance: number };

export function rankLessons(input: {
  lessons: TuningErrorLesson[];
  queryEmbedding: number[];
  queryKeywords: string[];
  limit?: number;
}): RankedLesson[] {
  const limit = Math.min(Math.max(1, input.limit ?? MAX_LESSONS_PER_QUERY), MAX_LESSONS_PER_QUERY);
  const out: RankedLesson[] = [];
  for (const l of input.lessons) {
    if (l.status !== "active" && l.status !== "low_priority") continue; // obsolete/review/disabled never injected
    if (l.confidence === "unverified") continue; // never steer answers on unverified claims
    const vec = parseEmbedding(l.embedding);
    const sim = vec.length && input.queryEmbedding.length ? cosine(input.queryEmbedding, vec) : 0;
    if (sim < LESSON_RELEVANCE_THRESHOLD) continue;
    let keywords: string[] = [];
    try {
      const meta = JSON.parse(l.relevanceMetadata) as { keywords?: string[] };
      if (Array.isArray(meta.keywords)) keywords = meta.keywords;
    } catch {
      /* defensive */
    }
    const kw = jaccard(input.queryKeywords, keywords);
    const weight = CONFIDENCE_WEIGHT[l.confidence] ?? 0.25;
    const statusMul = l.status === "low_priority" ? 0.6 : 1;
    const occurrenceBoost = Math.min(0.15, 0.05 * Math.log10((l.occurrenceCount ?? 1) + 1) * 2);
    out.push({ ...l, relevance: (sim * 0.7 + kw * 0.3) * weight * statusMul + occurrenceBoost });
  }
  out.sort((a, b) => b.relevance - a.relevance);
  return out.slice(0, limit);
}

/** Current high-confidence tuned evidence outranks old/low lessons — caller drops these. */
export function lessonOutrankedByChunks(
  lesson: Pick<TuningErrorLesson, "confidence" | "relevanceMetadata">,
  chunks: { score: number }[],
): boolean {
  if (!chunks.length) return false;
  const strong = chunks.some((c) => c.score > 0.3);
  return strong && (lesson.confidence === "low" || lesson.confidence === "unverified");
}

/* ── Prompt rendering (short, actionable, budgeted) ────────────── */

export function formatLessonsForPrompt(lessons: RankedLesson[]): string {
  if (!lessons.length) return "";
  const lines = lessons.slice(0, MAX_LESSONS_PER_QUERY).map((l, i) => {
    const rule = cap(l.preventionRule, MAX_RULE_CHARS);
    const topic = l.topic ? ` [${cap(l.topic, 60)}]` : "";
    return `${i + 1}. [${l.errorType}]${topic} ${rule}`;
  });
  const block = `Relevant learned lessons (verified past mistakes — apply their prevention rules, but current tuned passages outrank them on conflict):\n${lines.join("\n")}`;
  return block.slice(0, 1200);
}

/* ── DB layer (all queries scoped by userId first) ─────────────── */

export type NewLessonInput = {
  kbId: string | null;
  subjectId?: string | null;
  topic?: string | null;
  errorType: ErrorLessonType;
  mistakeSummary: string;
  rootCause: string;
  correctApproach: string;
  preventionRule: string;
  evidence: string;
  origin: "user_correction" | "feedback" | "technical";
  confidence: ErrorLessonConfidence;
  keywords: string[];
};

export function lessonEmbeddingFor(keywords: string[], extra: string): number[] {
  return localEmbed(`${keywords.join(" ")} ${extra}`.slice(0, 2000));
}

/** Load the candidate scope for dedupe/retrieval: this user's lessons for this KB (+ user-wide kbId NULL). Never another user. */
export async function loadScopedLessons(userId: string, kbId: string | null): Promise<TuningErrorLesson[]> {
  const kbCond = kbId ? or(eq(tuningErrorLessons.kbId, kbId), isNull(tuningErrorLessons.kbId)) : undefined;
  const where = kbCond ? and(eq(tuningErrorLessons.userId, userId), kbCond) : eq(tuningErrorLessons.userId, userId);
  const rows = await db.select().from(tuningErrorLessons).where(where).orderBy(desc(tuningErrorLessons.updatedAt)).limit(200).all();
  // Defense-in-depth: re-apply scope in memory (mirrors dedupeAndRank's isolation re-check).
  return scopeLessons(rows, kbId);
}

/** Pure scope filter — KB lessons stay in their KB; user-wide (null) lessons apply anywhere for that user. */
export function scopeLessons(lessons: TuningErrorLesson[], kbId: string | null): TuningErrorLesson[] {
  if (!kbId) return lessons;
  return lessons.filter((l) => !l.kbId || l.kbId === kbId);
}

/**
 * Dedupe-aware store: updates the existing lesson when a similar one
 * exists (occurrence++, evidence merge, confidence strengthen), else
 * inserts. Returns the row + whether it was an update.
 */
export async function saveOrUpdateLesson(
  userId: string,
  input: NewLessonInput,
): Promise<{ lesson: TuningErrorLesson; updated: boolean }> {
  const now = new Date().toISOString();
  const keywords = [...new Set(input.keywords.map((k) => k.toLowerCase()).filter(Boolean))].slice(0, 12);
  const embedding = lessonEmbeddingFor(keywords, `${input.mistakeSummary} ${input.preventionRule}`);
  const scoped = await loadScopedLessons(userId, input.kbId);
  const dupeId = findDuplicateLesson(
    scoped.map((l) => ({ id: l.id, embedding: parseEmbedding(l.embedding), keywords: keywordsOf(l) })),
    { embedding, keywords },
  );
  if (dupeId) {
    const prev = scoped.find((l) => l.id === dupeId)!;
    const nextConfidence = strengthenedConfidence(prev.confidence as ErrorLessonConfidence, input.confidence);
    const mergedEvidence = cap(`${prev.sourceEvidence} | ${input.evidence}`.slice(0, 800), 800);
    await db
      .update(tuningErrorLessons)
      .set({
        occurrenceCount: (prev.occurrenceCount ?? 1) + 1,
        sourceEvidence: JSON.stringify({
          merged: mergedEvidence,
          origin: input.origin,
          prevConfidence: prev.confidence,
        }),
        confidence: nextConfidence,
        // Improve the rule when the new one is more specific (longer, capped).
        preventionRule:
          input.preventionRule.length > prev.preventionRule.length ? cap(input.preventionRule, MAX_RULE_CHARS) : prev.preventionRule,
        lastOccurredAt: now,
        updatedAt: now,
      })
      .where(eq(tuningErrorLessons.id, prev.id))
      .run();
    const updated = (await db.select().from(tuningErrorLessons).where(eq(tuningErrorLessons.id, prev.id)).limit(1).all())[0]!;
    return { lesson: updated, updated: true };
  }
  const id = uid();
  const row = {
    id,
    userId,
    kbId: input.kbId,
    subjectId: input.subjectId ?? null,
    topic: input.topic ? cap(input.topic, 120) : null,
    errorType: input.errorType,
    mistakeSummary: cap(input.mistakeSummary, MAX_FIELD_CHARS),
    rootCause: cap(input.rootCause, MAX_FIELD_CHARS),
    correctApproach: cap(input.correctApproach, MAX_FIELD_CHARS),
    preventionRule: cap(input.preventionRule, MAX_RULE_CHARS),
    sourceEvidence: JSON.stringify({ evidence: cap(input.evidence, 500), origin: input.origin }),
    confidence: input.confidence,
    relevanceMetadata: JSON.stringify({ keywords }),
    embedding: JSON.stringify(embedding),
    occurrenceCount: 1,
    usageCount: 0,
    status: "active" as ErrorLessonStatus,
    createdAt: now,
    updatedAt: now,
    lastOccurredAt: now,
    lastUsedAt: null,
  };
  await db.insert(tuningErrorLessons).values(row).run();
  const lesson = (await db.select().from(tuningErrorLessons).where(eq(tuningErrorLessons.id, id)).limit(1).all())[0]!;
  return { lesson, updated: false };
}

function keywordsOf(l: TuningErrorLesson): string[] {
  try {
    const meta = JSON.parse(l.relevanceMetadata) as { keywords?: string[] };
    return Array.isArray(meta.keywords) ? meta.keywords : [];
  } catch {
    return [];
  }
}

/**
 * Retrieve only the best-matching lessons for this query — scoped by
 * user + KB, budgeted to MAX_LESSONS_PER_QUERY, failure-safe (throws
 * nothing; returns [] so the AI still responds normally).
 */
export async function retrieveRelevantLessons(input: {
  userId: string;
  kbId: string | null;
  query: string;
  chunks?: { score: number }[];
  limit?: number;
}): Promise<RankedLesson[]> {
  try {
    const scoped = await loadScopedLessons(input.userId, input.kbId);
    if (!scoped.length) return [];
    const ranked = rankLessons({
      lessons: scoped,
      queryEmbedding: localEmbed(input.query.slice(0, 2000)),
      queryKeywords: keywordTermsOf(input.query.toLowerCase()),
      limit: input.limit ?? MAX_LESSONS_PER_QUERY,
    });
    const kept = input.chunks ? ranked.filter((l) => !lessonOutrankedByChunks(l, input.chunks!)) : ranked;
    if (kept.length) {
      const now = new Date().toISOString();
      for (const l of kept) {
        await db
          .update(tuningErrorLessons)
          .set({ usageCount: (l.usageCount ?? 0) + 1, lastUsedAt: now })
          .where(eq(tuningErrorLessons.id, l.id))
          .run();
      }
    }
    return kept;
  } catch {
    return []; // retrieval failure must never break the AI response
  }
}
