"use server";

import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, uid } from "@/lib/db";
import { assessmentAttempts, flashcards, mindmaps, subjects, topics, units } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/actions";
import { rateLimit } from "@/lib/security/rate-limit";
import { AiSchemaError } from "@/lib/ai/types";
import {
  generateGeneralQuizSet,
  generateQuizSet,
  normalizeConfig,
  validateGeneralPrompt,
  type GradedAnswer,
} from "@/lib/assess/quiz";
import {
  generateFlashcardSet,
  validateFlashcardMaterial,
  type GeneratedFlashcard,
} from "@/lib/assess/flashcards";
import { generateMindMap, validateMindMapMaterial, type MindMap } from "@/lib/assess/mindmaps";
import { getStudySyllabusTree, getSyllabusStudyContext } from "@/lib/study/sources";
import { nextReviewInterval } from "@/lib/study/scheduling";

/* ── Shared Study Intelligence actions ──
   Quiz / Flashcards / Mind Maps share one retrieval path (sources.ts)
   and one AI discipline (Zod-validated, server-trusted). No new
   tables: quizzes → assessment_attempts, flashcards → flashcards,
   mind maps → stateless (generated on demand, never stored). */

const GEN_LIMIT = { limit: 8, windowMs: 10 * 60 * 1000 };

function friendly(err: unknown, fallback: string): string {
  if (err instanceof AiSchemaError) return err.message;
  const msg = err instanceof Error ? err.message : "";
  if (/rate limit|429/i.test(msg)) return "The AI service is busy — wait a moment and try again.";
  if (/timeout|timed out|fetch failed|network/i.test(msg)) return "The AI service did not respond in time. Try again.";
  return fallback;
}

/* ── Syllabus tree for selectors ── */

export async function getStudySyllabusAction() {
  const user = await requireUser();
  return getStudySyllabusTree(user.id);
}

/* ── Quiz: syllabus source ── */

const SyllabusQuizSchema = z.object({
  subjectId: z.string().min(1).max(64),
  unitId: z.string().min(1).max(64).optional(),
  topicId: z.string().min(1).max(64).optional(),
  count: z.number().int().min(3).max(10).optional().default(5),
  difficulty: z.enum(["easy", "medium", "hard"]).optional().default("medium"),
  focus: z.string().max(120).optional(),
});

async function storeQuizAttempt(
  userId: string,
  set: { questions: { id: string; topic: string; question: string; options: string[]; difficulty: string }[] },
  opts: { subjectId: string | null; materialExcerpt: string; materialHash: string; source: Record<string, unknown>; config: Record<string, unknown> },
) {
  const id = uid();
  const now = new Date().toISOString();
  await db.insert(assessmentAttempts).values({
    id,
    userId,
    subjectId: opts.subjectId,
    mode: "quiz",
    status: "active",
    materialExcerpt: opts.materialExcerpt.slice(0, 4000),
    materialHash: opts.materialHash,
    promptJson: JSON.stringify({ questions: set.questions, config: opts.config, source: opts.source }),
    resultJson: JSON.stringify({ answers: [] as GradedAnswer[] }),
    createdAt: now,
    updatedAt: now,
  });
  const safe = set.questions.map((q) => ({
    id: q.id,
    topic: q.topic,
    question: q.question,
    options: q.options,
    difficulty: q.difficulty,
  }));
  return { attemptId: id, questions: safe };
}

export async function generateSyllabusQuizAction(input: z.input<typeof SyllabusQuizSchema>) {
  const user = await requireUser();
  const rl = rateLimit(`study-quiz:${user.id}`, GEN_LIMIT);
  if (!rl.allowed) return { ok: false as const, error: "Quiz generation is rate-limited — try again in a few minutes." };
  const parsed = SyllabusQuizSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Pick a subject first, then difficulty." };
  const { subjectId, unitId, topicId, count, difficulty, focus } = parsed.data;

  const ctx = await getSyllabusStudyContext(user.id, { subjectId, unitId, topicId }, focus?.trim() || undefined);
  if (!ctx) return { ok: false as const, error: "Subject not found." };
  if (ctx.materialText.trim().length < 60) {
    return {
      ok: false as const,
      error: "This subject has no topics or notes yet — add topics in Syllabus first, or use a General quiz.",
    };
  }
  const { materialHash } = await import("@/lib/assess/quiz");
  const config = normalizeConfig({ count, difficulty: difficulty === "medium" ? "mixed" : difficulty, topicFocus: focus });
  try {
    const set = await generateQuizSet(ctx.materialText, config);
    const stored = await storeQuizAttempt(user.id, set, {
      subjectId,
      materialExcerpt: ctx.materialText,
      materialHash: materialHash(ctx.materialText),
      source: {
        type: "syllabus",
        subjectId,
        subjectName: ctx.subject.name,
        unitId: ctx.unit?.id ?? null,
        topicId: topicId ?? null,
        scope: ctx.coverage.topicScope,
      },
      config,
    });
    return { ok: true as const, ...stored };
  } catch (err) {
    return { ok: false as const, error: friendly(err, "Could not generate the quiz. Try again.") };
  }
}

/* ── Quiz: general source ── */

const GeneralQuizSchema = z.object({
  prompt: z.string().min(1).max(500),
  count: z.number().int().min(3).max(10).optional().default(5),
  difficulty: z.enum(["easy", "medium", "hard"]).optional().default("medium"),
});

export async function generateGeneralQuizAction(input: z.input<typeof GeneralQuizSchema>) {
  const user = await requireUser();
  const rl = rateLimit(`study-quiz:${user.id}`, GEN_LIMIT);
  if (!rl.allowed) return { ok: false as const, error: "Quiz generation is rate-limited — try again in a few minutes." };
  const parsed = GeneralQuizSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Tell me what to quiz you on first." };
  const checked = validateGeneralPrompt(parsed.data.prompt);
  if (!checked.ok) return { ok: false as const, error: checked.error };
  const { materialHash } = await import("@/lib/assess/quiz");
  const config = normalizeConfig({ count: parsed.data.count, difficulty: parsed.data.difficulty === "medium" ? "mixed" : parsed.data.difficulty });
  try {
    const set = await generateGeneralQuizSet(checked.prompt, config);
    const stored = await storeQuizAttempt(user.id, set, {
      subjectId: null,
      materialExcerpt: checked.prompt,
      materialHash: materialHash(checked.prompt),
      source: { type: "general", prompt: checked.prompt.slice(0, 200) },
      config,
    });
    return { ok: true as const, ...stored };
  } catch (err) {
    return { ok: false as const, error: friendly(err, "Could not generate the quiz. Try again.") };
  }
}

/* ── Flashcards ── */

const FlashcardGenSchema = z.object({
  source: z.enum(["syllabus", "general"]),
  subjectId: z.string().min(1).max(64).optional(),
  unitId: z.string().min(1).max(64).optional(),
  topicId: z.string().min(1).max(64).optional(),
  prompt: z.string().max(500).optional(),
  count: z.number().int().min(3).max(12).optional().default(8),
});

export async function generateFlashcardsAction(input: z.input<typeof FlashcardGenSchema>) {
  const user = await requireUser();
  const rl = rateLimit(`study-cards:${user.id}`, GEN_LIMIT);
  if (!rl.allowed) return { ok: false as const, error: "Flashcard generation is rate-limited — try again in a few minutes." };
  const parsed = FlashcardGenSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Pick a source first — syllabus or general." };

  let material: string;
  let general = false;
  let subjectId: string | null = null;
  let topicId: string | null = null;
  if (parsed.data.source === "syllabus") {
    if (!parsed.data.subjectId) return { ok: false as const, error: "Pick a subject first." };
    const ctx = await getSyllabusStudyContext(user.id, {
      subjectId: parsed.data.subjectId,
      unitId: parsed.data.unitId,
      topicId: parsed.data.topicId,
    });
    if (!ctx) return { ok: false as const, error: "Subject not found." };
    const checked = validateFlashcardMaterial(ctx.materialText);
    if (!checked.ok) {
      return { ok: false as const, error: "This subject has no topics or notes yet — add topics in Syllabus first, or use a General prompt." };
    }
    material = checked.material;
    subjectId = ctx.subject.id;
    topicId = parsed.data.topicId ?? null;
  } else {
    const checked = validateGeneralPrompt(parsed.data.prompt ?? "");
    if (!checked.ok) return { ok: false as const, error: checked.error };
    general = true;
    material = checked.prompt;
  }

  try {
    const set = await generateFlashcardSet(material, parsed.data.count ?? 8, general);
    const now = new Date().toISOString();
    const cards = set.cards.map((c: GeneratedFlashcard) => ({
      id: uid(),
      userId: user.id,
      subjectId,
      topicId,
      front: c.front,
      back: `${c.back}${c.memoryTip ? `\n\nMemory tip: ${c.memoryTip}` : ""}`,
      source: "ai" as const,
      createdAt: now,
      updatedAt: now,
    }));
    for (const c of cards) {
      await db.insert(flashcards).values(c);
    }
    return {
      ok: true as const,
      cards: cards.map((c) => ({ id: c.id, front: c.front, back: c.back })),
    };
  } catch (err) {
    return { ok: false as const, error: friendly(err, "Could not generate flashcards. Try again.") };
  }
}

export async function getFlashcardsAction(input: { subjectId?: string } = {}) {
  const user = await requireUser();
  const rows =
    input.subjectId !== undefined
      ? await db
          .select()
          .from(flashcards)
          .where(and(eq(flashcards.userId, user.id), eq(flashcards.subjectId, input.subjectId)))
          .orderBy(desc(flashcards.createdAt))
          .limit(200)
          .all()
      : await db
          .select()
          .from(flashcards)
          .where(eq(flashcards.userId, user.id))
          .orderBy(desc(flashcards.createdAt))
          .limit(200)
          .all();
  const subjRows = await db.select({ id: subjects.id, name: subjects.name }).from(subjects).where(eq(subjects.userId, user.id)).all();
  const names = new Map(subjRows.map((s) => [s.id, s.name]));
  return rows.map((c) => ({
    id: c.id,
    front: c.front,
    back: c.back,
    source: c.source,
    subjectId: c.subjectId,
    subjectName: c.subjectId ? (names.get(c.subjectId) ?? null) : null,
    reviewCount: c.reviewCount,
    dueAt: c.dueAt,
    createdAt: c.createdAt,
  }));
}

const GradeCardSchema = z.object({
  cardId: z.string().min(1).max(64),
  rating: z.enum(["easy", "practice", "hard"]),
});

export async function gradeFlashcardAction(input: z.input<typeof GradeCardSchema>) {
  const user = await requireUser();
  const parsed = GradeCardSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid rating." };
  const card = (
    await db
      .select()
      .from(flashcards)
      .where(and(eq(flashcards.id, parsed.data.cardId), eq(flashcards.userId, user.id)))
      .limit(1)
      .all()
  )[0];
  if (!card) return { ok: false as const, error: "Card not found." };
  const interval = nextReviewInterval(card.intervalDays ?? 0, parsed.data.rating);
  const now = new Date().toISOString();
  await db
    .update(flashcards)
    .set({
      ease: parsed.data.rating === "easy" ? Math.min(3, (card.ease ?? 2.5) + 0.1) : Math.max(1.3, (card.ease ?? 2.5) - 0.15),
      intervalDays: interval,
      reviewCount: (card.reviewCount ?? 0) + 1,
      dueAt: new Date(Date.now() + interval * 86400000).toISOString(),
      lastReviewedAt: now,
      updatedAt: now,
    })
    .where(eq(flashcards.id, card.id))
    .run();
  return { ok: true as const, intervalDays: interval };
}

export async function deleteFlashcardAction(cardId: string) {
  const user = await requireUser();
  await db.delete(flashcards).where(and(eq(flashcards.id, cardId), eq(flashcards.userId, user.id))).run();
  return { ok: true as const };
}

/* ── Mind maps (stateless — generated on demand, never stored) ── */

const MindMapGenSchema = z.object({
  source: z.enum(["syllabus", "general"]),
  subjectId: z.string().min(1).max(64).optional(),
  unitId: z.string().min(1).max(64).optional(),
  topicId: z.string().min(1).max(64).optional(),
  prompt: z.string().max(500).optional(),
});

export async function generateMindMapAction(input: z.input<typeof MindMapGenSchema>): Promise<
  | { ok: true; id: string; map: MindMap; sourceLabel: string }
  | { ok: false; error: string }
> {
  const user = await requireUser();
  const rl = rateLimit(`study-map:${user.id}`, GEN_LIMIT);
  if (!rl.allowed) return { ok: false as const, error: "Mind-map generation is rate-limited — try again in a few minutes." };
  const parsed = MindMapGenSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Pick a source first — syllabus or general." };

  let material: string;
  let general = false;
  let sourceLabel = "General knowledge";
  let subjectId: string | null = null;
  let originPrompt = "";
  if (parsed.data.source === "syllabus") {
    if (!parsed.data.subjectId) return { ok: false as const, error: "Pick a subject first." };
    const ctx = await getSyllabusStudyContext(user.id, {
      subjectId: parsed.data.subjectId,
      unitId: parsed.data.unitId,
      topicId: parsed.data.topicId,
    });
    if (!ctx) return { ok: false as const, error: "Subject not found." };
    const checked = validateMindMapMaterial(ctx.materialText);
    if (!checked.ok) {
      return { ok: false as const, error: "This subject has no topics or notes yet — add topics in Syllabus first, or use a General prompt." };
    }
    material = checked.material;
    subjectId = ctx.subject.id;
    sourceLabel = `Syllabus · ${ctx.subject.name}${ctx.unit ? ` · ${ctx.unit.name}` : ""}`;
    originPrompt = sourceLabel;
  } else {
    const checked = validateGeneralPrompt(parsed.data.prompt ?? "");
    if (!checked.ok) return { ok: false as const, error: checked.error };
    general = true;
    material = checked.prompt;
    originPrompt = checked.prompt.slice(0, 200);
  }

  try {
    const map = await generateMindMap(material, general);
    // Persist so the map survives reloads and Pilot can reference it.
    const id = uid();
    const now = new Date().toISOString();
    await db.insert(mindmaps).values({
      id,
      userId: user.id,
      subjectId,
      title: map.central.slice(0, 120),
      prompt: originPrompt.slice(0, 500),
      source: parsed.data.source,
      mapJson: JSON.stringify(map),
      createdAt: now,
      updatedAt: now,
    });
    return { ok: true as const, id, map, sourceLabel };
  } catch (err) {
    return { ok: false as const, error: friendly(err, "Could not generate the mind map. Try again.") };
  }
}

export type SavedMindmap = { id: string; title: string; source: string; sourceLabel: string; createdAt: string | null; map: MindMap };

function parseMindMap(raw: string | null): MindMap | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as MindMap;
    if (!parsed.central || !Array.isArray(parsed.branches)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function getMindmapsAction(): Promise<SavedMindmap[]> {
  const user = await requireUser();
  const rows = await db
    .select()
    .from(mindmaps)
    .where(eq(mindmaps.userId, user.id))
    .orderBy(desc(mindmaps.createdAt))
    .limit(50)
    .all();
  const out: SavedMindmap[] = [];
  for (const r of rows) {
    const map = parseMindMap(r.mapJson);
    if (!map) continue;
    out.push({
      id: r.id,
      title: r.title,
      source: r.source,
      sourceLabel: r.source === "syllabus" ? `Syllabus · ${r.prompt || r.title}` : "General knowledge",
      createdAt: r.createdAt,
      map,
    });
  }
  return out;
}

export async function deleteMindmapAction(id: string) {
  const user = await requireUser();
  await db.delete(mindmaps).where(and(eq(mindmaps.id, id), eq(mindmaps.userId, user.id))).run();
  return { ok: true as const };
}

/* ── Personalization signals: what to practice next ── */

export async function getStudySignalsAction(): Promise<{
  needsPractice: { subjectId: string | null; subjectName: string | null; topic: string; missed: number }[];
  revisionTopics: { subjectName: string; topicName: string }[];
}> {
  const user = await requireUser();
  // Topics the student marked for revision (owned syllabus only).
  const subjRows = await db.select({ id: subjects.id, name: subjects.name }).from(subjects).where(eq(subjects.userId, user.id)).all();
  const byId = new Map(subjRows.map((s) => [s.id, s.name]));
  const unitRows = subjRows.length ? await db.select().from(units).where(inArray(units.subjectId, subjRows.map((s) => s.id))).all() : [];
  const unitSubject = new Map(unitRows.map((u) => [u.id, u.subjectId]));
  const revisionRows = unitRows.length
    ? await db
        .select()
        .from(topics)
        .where(and(inArray(topics.unitId, unitRows.map((u) => u.id)), eq(topics.status, "needs_revision")))
        .limit(10)
        .all()
    : [];
  const revisionTopics = revisionRows.map((t) => {
    const sid = unitSubject.get(t.unitId) ?? null;
    return { subjectName: (sid ? byId.get(sid) : null) ?? "Syllabus", topicName: t.name };
  });

  // Recent quiz mistakes (server-graded attempts only — never client claims).
  const recent = await db
    .select({ resultJson: assessmentAttempts.resultJson, subjectId: assessmentAttempts.subjectId })
    .from(assessmentAttempts)
    .where(and(eq(assessmentAttempts.userId, user.id), eq(assessmentAttempts.mode, "quiz"), eq(assessmentAttempts.status, "graded")))
    .orderBy(desc(assessmentAttempts.updatedAt))
    .limit(5)
    .all();
  const misses = new Map<string, { missed: number; subjectId: string | null }>();
  for (const r of recent) {
    try {
      const parsed = JSON.parse(r.resultJson) as { answers?: { topic: string; correct: boolean }[] };
      for (const a of parsed.answers ?? []) {
        if (!a.correct && a.topic) {
          const cur = misses.get(a.topic) ?? { missed: 0, subjectId: r.subjectId };
          misses.set(a.topic, { missed: cur.missed + 1, subjectId: cur.subjectId });
        }
      }
    } catch {
      /* corrupted row — skip, never trust blindly */
    }
  }
  const needsPractice = [...misses.entries()]
    .map(([topic, v]) => ({
      subjectId: v.subjectId,
      subjectName: v.subjectId ? (byId.get(v.subjectId) ?? null) : null,
      topic,
      missed: v.missed,
    }))
    .sort((a, b) => b.missed - a.missed)
    .slice(0, 8);
  return { needsPractice, revisionTopics };
}
