/* ──────────────────────────────────────────────────────────────
   Study Intelligence — shared syllabus retrieval (Phase 2).

   One reliable path for Quiz / Flashcards / Mind Maps to turn
   existing syllabus data into grounded AI context:

     Authenticated User + Subject (+ Unit / Topic) + relevant
     material → capped, scoped context text.

   Hard rules: never another user's data; never unrelated subjects;
   never whole libraries — ranked, capped, traceable.
   ────────────────────────────────────────────────────────────── */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { materials, subjects, topics, units } from "@/lib/db/schema";

export type StudyScope = {
  subjectId: string;
  unitId?: string | null;
  topicId?: string | null;
};

export type SyllabusContext = {
  subject: { id: string; name: string };
  unit: { id: string; name: string } | null;
  topics: { id: string; name: string; description: string | null; status: string }[];
  /** Grounded material text, capped and scoped (never the whole library). */
  materialText: string;
  coverage: { topicCount: number; materialCount: number; topicScope: "subject" | "unit" | "topic" };
};

export const MAX_SYLLABUS_CHARS = 8000;
const MAX_MATERIAL_DOCS = 6;

/** Pure builder — fixtures in, scoped text out (unit-testable, no DB). */
export function buildSyllabusMaterialText(input: {
  subjectName: string;
  unitName: string | null;
  topics: { name: string; description: string | null; status: string }[];
  excerpts: string[];
  focus?: string;
}): string {
  const parts: string[] = [`Subject: ${input.subjectName}`];
  if (input.unitName) parts.push(`Unit: ${input.unitName}`);
  if (input.topics.length) {
    parts.push("Topics:");
    for (const t of input.topics.slice(0, 40)) {
      parts.push(`- ${t.name}${t.description ? `: ${t.description.slice(0, 200)}` : ""}`);
    }
  }
  const body = input.excerpts
    .map((e) => e.trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, MAX_SYLLABUS_CHARS);
  if (body) parts.push(`Study notes:\n${body}`);
  if (input.focus) parts.push(`Focus especially on: ${input.focus.slice(0, 120)}`);
  return parts.join("\n").slice(0, MAX_SYLLABUS_CHARS + 2000);
}

/**
 * Ownership-checked syllabus context. Returns null when the subject
 * (or unit/topic) does not belong to this user — callers turn that
 * into "not found", never into another user's data.
 */
export async function getSyllabusStudyContext(
  userId: string,
  scope: StudyScope,
  focus?: string,
): Promise<SyllabusContext | null> {
  const subj = (
    await db
      .select({ id: subjects.id, name: subjects.name })
      .from(subjects)
      .where(and(eq(subjects.id, scope.subjectId), eq(subjects.userId, userId)))
      .limit(1)
      .all()
  )[0];
  if (!subj) return null;

  const unitRows = await db
    .select({ id: units.id, name: units.name })
    .from(units)
    .where(eq(units.subjectId, subj.id))
    .all();
  let unit: { id: string; name: string } | null = null;
  let unitIds = unitRows.map((u) => u.id);
  if (scope.unitId) {
    const found = unitRows.find((u) => u.id === scope.unitId);
    if (!found) return null;
    unit = { id: found.id, name: found.name };
    unitIds = [found.id];
  }

  let topicRows =
    unitIds.length > 0
      ? await db
          .select({ id: topics.id, unitId: topics.unitId, name: topics.name, description: topics.description, status: topics.status })
          .from(topics)
          .where(inArray(topics.unitId, unitIds))
          .all()
      : [];
  let topicScope: SyllabusContext["coverage"]["topicScope"] = unit ? "unit" : "subject";
  if (scope.topicId) {
    const found = topicRows.find((t) => t.id === scope.topicId);
    if (!found) return null;
    topicRows = [found];
    topicScope = "topic";
  }

  // Subject-scoped notes only — never other subjects, never other users.
  const mats = await db
    .select({ excerpt: materials.excerpt })
    .from(materials)
    .where(and(eq(materials.userId, userId), eq(materials.subjectId, subj.id)))
    .limit(MAX_MATERIAL_DOCS)
    .all();
  const excerpts = mats.map((m) => m.excerpt ?? "").filter((e) => e.trim().length > 0);

  const materialText = buildSyllabusMaterialText({
    subjectName: subj.name,
    unitName: unit?.name ?? null,
    topics: topicRows.map((t) => ({ name: t.name, description: t.description, status: t.status })),
    excerpts,
    focus,
  });

  return {
    subject: subj,
    unit,
    topics: topicRows.map((t) => ({ id: t.id, name: t.name, description: t.description, status: t.status })),
    materialText,
    coverage: { topicCount: topicRows.length, materialCount: excerpts.length, topicScope },
  };
}

/** Lightweight syllabus tree for selectors (names only, owned data). */
export async function getStudySyllabusTree(userId: string): Promise<
  { id: string; name: string; units: { id: string; name: string; topics: { id: string; name: string; status: string }[] }[] }[]
> {
  const subjRows = await db
    .select({ id: subjects.id, name: subjects.name })
    .from(subjects)
    .where(eq(subjects.userId, userId))
    .all();
  if (!subjRows.length) return [];
  const ids = subjRows.map((s) => s.id);
  const unitRows = await db.select().from(units).where(inArray(units.subjectId, ids)).all();
  const unitIds = unitRows.map((u) => u.id);
  const topicRows = unitIds.length ? await db.select().from(topics).where(inArray(topics.unitId, unitIds)).all() : [];
  return subjRows.map((s) => ({
    id: s.id,
    name: s.name,
    units: unitRows
      .filter((u) => u.subjectId === s.id)
      .map((u) => ({
        id: u.id,
        name: u.name,
        topics: topicRows.filter((t) => t.unitId === u.id).map((t) => ({ id: t.id, name: t.name, status: t.status })),
      })),
  }));
}
