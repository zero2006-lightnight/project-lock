"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, uid } from "@/lib/db";
import { exams, subjects, tasks, topics, units } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/actions";

const subjectSchema = z.object({
  name: z.string().min(1).max(80),
  color: z.string().min(3).max(9).default("#5753d4"),
  priority: z.coerce.number().int().min(1).max(3).default(2),
  difficulty: z.coerce.number().int().min(1).max(3).default(2),
});

export type SubjectInput = z.infer<typeof subjectSchema>;

export async function createSubjectAction(input: SubjectInput) {
  const user = await requireUser();
  const parsed = subjectSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid subject details" };

  const count = await db.select({ id: subjects.id }).from(subjects).where(eq(subjects.userId, user.id)).all();
  await db.insert(subjects).values({
    id: uid(),
    userId: user.id,
    name: parsed.data.name,
    color: parsed.data.color,
    priority: parsed.data.priority,
    difficulty: parsed.data.difficulty,
    sortOrder: count.length,
  });
  revalidatePath("/app/subjects");
  revalidatePath("/app/syllabus");
  revalidatePath("/app/dashboard");
  return { ok: true as const };
}

export async function updateSubjectAction(id: string, input: SubjectInput) {
  const user = await requireUser();
  const parsed = subjectSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid subject details" };
  await db
    .update(subjects)
    .set({ ...parsed.data, updatedAt: new Date().toISOString() })
    .where(and(eq(subjects.id, id), eq(subjects.userId, user.id)))
    .run();
  revalidatePath("/app/subjects");
  revalidatePath("/app/syllabus");
  return { ok: true as const };
}

export async function deleteSubjectAction(id: string) {
  const user = await requireUser();
  await db
    .update(subjects)
    .set({ deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    .where(and(eq(subjects.id, id), eq(subjects.userId, user.id)))
    .run();
  revalidatePath("/app/subjects");
  revalidatePath("/app/syllabus");
  return { ok: true as const };
}

/* ── Units & topics ──────────────────────────────────────────── */

export async function addUnitAction(subjectId: string, name: string) {
  const user = await requireUser();
  const [ownedSubject] = await db.select({ id: subjects.id }).from(subjects).where(and(eq(subjects.id, subjectId), eq(subjects.userId, user.id))).limit(1).all();
  if (!ownedSubject) return { ok: false as const, error: "Subject not found" };
  const n = name.trim();
  if (!n) return { ok: false as const, error: "Unit name is required" };
  const existing = await db.select().from(units).where(eq(units.subjectId, subjectId)).all();
  await db.insert(units).values({
    id: uid(),
    subjectId,
    name: n.slice(0, 120),
    sortOrder: existing.length,
  });
  revalidatePath("/app/syllabus");
  return { ok: true as const };
}

export async function deleteUnitAction(unitId: string) {
  const user = await requireUser();
  const [ownedUnit] = await db
    .select({ id: units.id })
    .from(units)
    .innerJoin(subjects, eq(units.subjectId, subjects.id))
    .where(and(eq(units.id, unitId), eq(subjects.userId, user.id)))
    .limit(1)
    .all();
  if (!ownedUnit) return { ok: false as const, error: "Unit not found" };
  await db.delete(units).where(eq(units.id, unitId)).run();
  revalidatePath("/app/syllabus");
  return { ok: true as const };
}

const topicSchema = z.object({
  name: z.string().min(1).max(120),
  difficulty: z.coerce.number().int().min(1).max(5).default(3),
  description: z.string().max(500).optional().nullable(),
});

export async function addTopicAction(unitId: string, input: { name: string; difficulty?: number; description?: string }) {
  const user = await requireUser();
  const [ownedUnit] = await db
    .select({ id: units.id })
    .from(units)
    .innerJoin(subjects, eq(units.subjectId, subjects.id))
    .where(and(eq(units.id, unitId), eq(subjects.userId, user.id)))
    .limit(1)
    .all();
  if (!ownedUnit) return { ok: false as const, error: "Unit not found" };
  const parsed = topicSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid topic" };
  const existing = await db.select().from(topics).where(eq(topics.unitId, unitId)).all();
  await db.insert(topics).values({
    id: uid(),
    unitId,
    name: parsed.data.name,
    difficulty: parsed.data.difficulty,
    description: parsed.data.description ?? null,
    status: "not_started",
    sortOrder: existing.length,
  });
  revalidatePath("/app/syllabus");
  return { ok: true as const };
}

export async function updateTopicAction(topicId: string, input: { name?: string; difficulty?: number; description?: string }) {
  const user = await requireUser();
  const [ownedTopic] = await db
    .select({ id: topics.id })
    .from(topics)
    .innerJoin(units, eq(topics.unitId, units.id))
    .innerJoin(subjects, eq(units.subjectId, subjects.id))
    .where(and(eq(topics.id, topicId), eq(subjects.userId, user.id)))
    .limit(1)
    .all();
  if (!ownedTopic) return { ok: false as const, error: "Topic not found" };
  const parsed = topicSchema.partial().safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid topic" };
  await db
    .update(topics)
    .set({ ...parsed.data, updatedAt: new Date().toISOString() })
    .where(eq(topics.id, topicId))
    .run();
  revalidatePath("/app/syllabus");
  return { ok: true as const };
}

const TOPIC_STATUSES = ["not_started", "learning", "completed", "needs_revision"] as const;

export async function setTopicStatusAction(topicId: string, status: (typeof TOPIC_STATUSES)[number]) {
  const user = await requireUser();
  const [ownedTopic] = await db
    .select({ id: topics.id })
    .from(topics)
    .innerJoin(units, eq(topics.unitId, units.id))
    .innerJoin(subjects, eq(units.subjectId, subjects.id))
    .where(and(eq(topics.id, topicId), eq(subjects.userId, user.id)))
    .limit(1)
    .all();
  if (!ownedTopic) return { ok: false as const, error: "Topic not found" };
  if (!TOPIC_STATUSES.includes(status)) return { ok: false as const, error: "Invalid status" };
  const now = new Date().toISOString();
  await db
    .update(topics)
    .set({
      status,
      completedAt: status === "completed" ? now : null,
      lastStudiedAt: status === "completed" ? now : undefined,
      updatedAt: now,
    })
    .where(eq(topics.id, topicId))
    .run();
  revalidatePath("/app/syllabus");
  revalidatePath("/app/subjects");
  return { ok: true as const };
}

export async function deleteTopicAction(topicId: string) {
  const user = await requireUser();
  const [ownedTopic] = await db
    .select({ id: topics.id })
    .from(topics)
    .innerJoin(units, eq(topics.unitId, units.id))
    .innerJoin(subjects, eq(units.subjectId, subjects.id))
    .where(and(eq(topics.id, topicId), eq(subjects.userId, user.id)))
    .limit(1)
    .all();
  if (!ownedTopic) return { ok: false as const, error: "Topic not found" };
  await db.delete(topics).where(eq(topics.id, topicId)).run();
  revalidatePath("/app/syllabus");
  return { ok: true as const };
}

/* ── Exams ───────────────────────────────────────────────────── */

const examSchema = z.object({
  name: z.string().min(1).max(120),
  subjectId: z.string().nullable().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid date"),
  importance: z.coerce.number().int().min(1).max(3).default(2),
});

export async function addExamAction(input: z.infer<typeof examSchema>) {
  const user = await requireUser();
  const parsed = examSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid exam details" };
  await db.insert(exams).values({
    id: uid(),
    userId: user.id,
    name: parsed.data.name,
    subjectId: parsed.data.subjectId ?? null,
    date: parsed.data.date,
    importance: parsed.data.importance,
  });
  revalidatePath("/app/exams");
  revalidatePath("/app");
  return { ok: true as const };
}

export async function deleteExamAction(id: string) {
  const user = await requireUser();
  await db.delete(exams).where(and(eq(exams.id, id), eq(exams.userId, user.id))).run();
  revalidatePath("/app/exams");
  revalidatePath("/app");
  return { ok: true as const };
}

/* ── Tasks ───────────────────────────────────────────────────── */

const taskSchema = z.object({
  title: z.string().min(1).max(160),
  subjectId: z.string().nullable().optional(),
  kind: z.enum(["assignment", "project", "lab", "quiz", "revision", "other"]).default("assignment"),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  priority: z.coerce.number().int().min(1).max(3).default(2),
  estimatedMinutes: z.coerce.number().int().min(5).max(600).default(60),
  notes: z.string().max(500).nullable().optional(),
});

export async function addTaskAction(input: z.infer<typeof taskSchema>) {
  const user = await requireUser();
  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid task details" };
  await db.insert(tasks).values({
    id: uid(),
    userId: user.id,
    title: parsed.data.title,
    subjectId: parsed.data.subjectId ?? null,
    kind: parsed.data.kind,
    deadline: parsed.data.deadline ?? null,
    priority: parsed.data.priority,
    estimatedMinutes: parsed.data.estimatedMinutes,
    notes: parsed.data.notes ?? null,
    status: "todo",
  });
  revalidatePath("/app/tasks");
  revalidatePath("/app");
  return { ok: true as const };
}

export async function updateTaskAction(id: string, input: z.infer<typeof taskSchema>) {
  const user = await requireUser();
  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid task details" };
  await db
    .update(tasks)
    .set({ ...parsed.data, deadline: parsed.data.deadline ?? null, updatedAt: new Date().toISOString() })
    .where(and(eq(tasks.id, id), eq(tasks.userId, user.id)))
    .run();
  revalidatePath("/app/tasks");
  revalidatePath("/app");
  return { ok: true as const };
}

export async function setTaskStatusAction(id: string, status: "todo" | "in_progress" | "completed" | "skipped") {
  const user = await requireUser();
  const now = new Date().toISOString();
  await db
    .update(tasks)
    .set({ status, completedAt: status === "completed" ? now : null, updatedAt: now })
    .where(and(eq(tasks.id, id), eq(tasks.userId, user.id)))
    .run();
  revalidatePath("/app/tasks");
  revalidatePath("/app");
  return { ok: true as const };
}

export async function completeTaskByTitleAction(title: string) {
  const user = await requireUser();
  const needle = title.trim().slice(0, 160);
  if (!needle) return { ok: false as const, error: "Tell me which task to complete." };
  const matches = await db
    .select({ id: tasks.id, title: tasks.title })
    .from(tasks)
    .where(and(eq(tasks.userId, user.id), eq(tasks.title, needle)))
    .limit(2)
    .all();
  if (matches.length === 0) return { ok: false as const, error: `I couldn't find a task named ${needle}.` };
  if (matches.length > 1) return { ok: false as const, error: `I found more than one task named ${needle}. Open Tasks to choose one.` };
  return setTaskStatusAction(matches[0]!.id, "completed");
}

export async function deleteTaskAction(id: string) {
  const user = await requireUser();
  await db.delete(tasks).where(and(eq(tasks.id, id), eq(tasks.userId, user.id))).run();
  revalidatePath("/app/tasks");
  return { ok: true as const };
}