"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, uid } from "@/lib/db";
import { subjects, topics, units } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/actions";
import { detectKind } from "@/lib/services/extract";
import { ParsedSyllabusSchema, type ParsedSyllabus } from "@/lib/services/syllabus-parse";
import { MAX_SYLLABUS_BYTES, runSyllabusPipeline } from "@/lib/services/syllabus-pipeline";
import { consumePreviewToken, mintPreviewToken } from "@/lib/services/import-tokens";

const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

export type ImportPreview =
  | { ok: true; token: string; syllabus: ParsedSyllabus; source: "ai" | "heuristic"; warning?: string }
  | { ok: false; error: string };

export type ImportCommitResult = { ok: true; subjectId: string; topicCount: number } | { ok: false; error: string };

/** Step 1 — upload + parse. Nothing is persisted to the syllabus yet. */
export async function parseSyllabusImportAction(input: {
  fileName: string;
  mimeType: string;
  dataBase64: string;
  subjectId?: string;
  importId?: string;
}): Promise<ImportPreview> {
  const user = await requireUser();
  const name = input.fileName.slice(0, 200);
  const buffer = Buffer.from(input.dataBase64, "base64");

  if (!buffer.length) return { ok: false, error: "The file is empty." };
  if (buffer.length > MAX_IMPORT_BYTES) return { ok: false, error: "File is too large — the limit is 20 MB." };

  const kind = detectKind(name, input.mimeType);
  if (!kind || kind === "image") {
    return { ok: false, error: "Unsupported syllabus format — upload a PDF, Word, Excel, CSV, JSON, Markdown or text file." };
  }

  // If importing INTO an existing subject, verify ownership now.
  if (input.subjectId) {
    const own = await db
      .select({ id: subjects.id })
      .from(subjects)
      .where(and(eq(subjects.id, input.subjectId), eq(subjects.userId, user.id)))
      .limit(1)
      .all();
    if (!own.length) return { ok: false, error: "Subject not found." };
  }

  // Optional subject-name hint from the filename ("dbms-syllabus.pdf" → "Dbms")
  const stem = name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim();
  const hint = stem.length >= 3 && stem.length <= 60 ? stem : undefined;

  const result = await runSyllabusPipeline(buffer, name, input.mimeType, {
    defaultSubjectName: hint,
    importId: input.importId,
  });
  if (!result.ok) return { ok: false, error: result.error };

  const token = mintPreviewToken(user.id, result.syllabus);
  return { ok: true, token, syllabus: result.syllabus, source: result.source, warning: result.warning };
}

const commitSchema = z.object({
  token: z.string().min(80).max(200000),
  subjectId: z.string().min(1).nullable(),
  newSubjectName: z.string().min(1).max(80).nullable(),
  syllabus: ParsedSyllabusSchema,
  mode: z.enum(["merge", "replace"]).default("merge"),
});

/** Step 2 — persist the (possibly user-edited) preview after explicit confirmation. */
export async function commitSyllabusImportAction(input: {
  token: string;
  subjectId: string | null;
  newSubjectName: string | null;
  syllabus: ParsedSyllabus;
  mode?: "merge" | "replace";
}): Promise<ImportCommitResult> {
  const user = await requireUser();
  const parsed = commitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid import payload." };
  const { token, subjectId, newSubjectName, syllabus, mode } = parsed.data;

  // Single-use token check (binds to the same user who parsed).
  const cached = consumePreviewToken(token, user.id);
  if (!cached) {
    return { ok: false, error: "This import preview expired — parse the file again." };
  }

  // Resolve target subject: existing (ownership-checked) or create new.
  let targetSubjectId: string;
  if (subjectId) {
    const own = await db
      .select({ id: subjects.id })
      .from(subjects)
      .where(and(eq(subjects.id, subjectId), eq(subjects.userId, user.id)))
      .limit(1)
      .all();
    if (!own.length) return { ok: false, error: "Subject not found." };
    targetSubjectId = subjectId;
  } else {
    if (!newSubjectName) return { ok: false, error: "Choose a subject or name a new one." };
    const count = await db.select({ id: subjects.id }).from(subjects).where(eq(subjects.userId, user.id)).all();
    const subjectIdNew = uid();
    await db.insert(subjects).values({
      id: subjectIdNew,
      userId: user.id,
      name: newSubjectName,
      color: "#0b57d0",
      priority: 2,
      difficulty: 2,
      sortOrder: count.length,
    });
    targetSubjectId = subjectIdNew;
  }

  const existingUnits = await db.select().from(units).where(eq(units.subjectId, targetSubjectId)).all();
  if (mode === "replace" && existingUnits.length) {
    await db.delete(units).where(eq(units.subjectId, targetSubjectId)).run();
  }

  // Persist units + topics. Edited preview content wins over the cache —
  // the user's review IS the confirmation.
  const unitOffset = mode === "replace" ? 0 : existingUnits.length;
  const existingUnitByName = new Map(existingUnits.map((unit) => [normalizeImportTitle(unit.name), unit]));
  let topicCount = 0;

  for (const [ui, u] of syllabus.subjects.flatMap((s) => s.units).entries()) {
    if (ui >= 100) break;
    const unitName = u.name.slice(0, 120);
    const existingUnit = mode === "merge" ? existingUnitByName.get(normalizeImportTitle(unitName)) : undefined;
    const unitId = existingUnit?.id ?? uid();
    if (!existingUnit) {
      await db.insert(units).values({ id: unitId, subjectId: targetSubjectId, name: unitName, sortOrder: unitOffset + ui });
    }
    const existingTopics = existingUnit
      ? await db.select().from(topics).where(eq(topics.unitId, unitId)).all()
      : [];
    const seenTopics = new Set(existingTopics.map((topic) => normalizeImportTitle(topic.name)));
    for (const [ti, t] of u.topics.entries()) {
      if (topicCount >= 1000) break;
      const topicName = t.name.slice(0, 120);
      const normalized = normalizeImportTitle(topicName);
      if (!normalized || seenTopics.has(normalized)) continue;
      seenTopics.add(normalized);
      await db.insert(topics).values({
        id: uid(),
        unitId,
        name: topicName,
        difficulty: t.difficulty,
        description: null,
        status: "not_started",
        sortOrder: existingTopics.length + ti,
      });
      topicCount++;
    }
  }

  if (topicCount === 0) {
    return { ok: false, error: "Nothing to import — the parsed structure had no topics." };
  }

  revalidatePath("/app/syllabus");
  revalidatePath("/app/subjects");
  revalidatePath("/app");
  return { ok: true, subjectId: targetSubjectId, topicCount };
}

function normalizeImportTitle(value: string): string {
  return value.toLowerCase().replace(/^\s*(unit|module|chapter|part)?\s*[ivxlcdm\d]+[\s:.)-]*/i, "").replace(/^\s*\d+[.)-]\s*/, "").replace(/[^a-z0-9]+/g, " ").trim();
}
