import { and, count, eq, gte, inArray } from "drizzle-orm";
import { db, uid } from "@/lib/db";
import { exams, planItems, tasks, topics, units } from "@/lib/db/schema";
import { addDaysISO, daysUntil, isPast, todayISO, type ISODate } from "@/lib/dates";
import { dayCapacityMinutes, generateSchedule } from "@/lib/engine/schedule";
import { redistributeMissed, type ExistingPlanSummary, type MissedBlock } from "@/lib/engine/reschedule";
import { getProfileBundle, getSubjectRows } from "./data";
import type { EngineAvailability, EngineExam, EngineSubject, EngineTask, EngineTopic } from "@/lib/engine/types";

export async function countPendingFrom(userId: string, from: ISODate): Promise<number> {
  const res = await db
    .select({ c: count() })
    .from(planItems)
    .where(and(eq(planItems.userId, userId), eq(planItems.status, "pending"), gte(planItems.date, from)))
    .all();
  return res[0]?.c ?? 0;
}

export async function getAvailability(userId: string): Promise<EngineAvailability> {
  const profile = await getProfileBundle(userId);
  if (!profile) throw new Error("User not found");
  return {
    weekdayHours: profile.weekdayHours,
    weekendHours: profile.weekendHours,
    preferredTimes: profile.preferredTimes,
    sessionStyle: profile.sessionStyle,
  };
}

export async function getSubjectMetaMap(userId: string): Promise<Record<string, { id: string; name: string; color: string }>> {
  const rows = await getSubjectRows(userId);
  const map: Record<string, { id: string; name: string; color: string }> = {};
  for (const s of rows) map[s.id] = { id: s.id, name: s.name, color: s.color };
  return map;
}

export async function getEngineTopicsForUser(userId: string, subjectIds?: string[]): Promise<EngineTopic[]> {
  const sRows = subjectIds ? subjectIds : (await getSubjectRows(userId)).map((s) => s.id);
  if (!sRows.length) return [];
  const unitRows = await db.select().from(units).where(inArray(units.subjectId, sRows)).all();
  if (!unitRows.length) return [];
  const topicRows = await db.select().from(topics).where(inArray(topics.unitId, unitRows.map((u) => u.id))).all();
  const unitSubject = new Map(unitRows.map((u) => [u.id, u.subjectId]));
  const unitOrder = new Map(unitRows.map((u, i) => [u.id, i]));
  return topicRows.map((t) => ({
    id: t.id,
    subjectId: unitSubject.get(t.unitId) ?? "",
    unitId: t.unitId,
    name: t.name,
    difficulty: t.difficulty,
    weight: t.weight,
    status: t.status,
    unitOrder: unitOrder.get(t.unitId) ?? 0,
    topicOrder: t.sortOrder,
    lastStudiedAt: t.lastStudiedAt,
  }));
}

async function buildEngineInput(userId: string) {
  const availability = await getAvailability(userId);
  const subjectRows = await getSubjectRows(userId);
  const subjectMeta: Record<string, { id: string; name: string; color: string }> = {};
  const engineSubjects: EngineSubject[] = subjectRows.map((s) => {
    subjectMeta[s.id] = { id: s.id, name: s.name, color: s.color };
    return { id: s.id, name: s.name, priority: s.priority, difficulty: s.difficulty };
  });

  const engineTopics = await getEngineTopicsForUser(userId);
  const examRows = await db.select().from(exams).where(eq(exams.userId, userId)).all();
  const engineExams: EngineExam[] = examRows.map((e) => ({
    id: e.id,
    subjectId: e.subjectId,
    name: e.name,
    date: e.date,
    importance: e.importance,
  }));

  const taskRows = await db.select().from(tasks).where(eq(tasks.userId, userId)).all();
  const engineTasks: EngineTask[] = taskRows.map((t) => ({
    id: t.id,
    subjectId: t.subjectId,
    title: t.title,
    deadline: t.deadline,
    status: t.status,
    estimatedMinutes: t.estimatedMinutes,
  }));

  return { availability, subjectMeta, engineSubjects, engineTopics, engineExams, engineTasks };
}

type PersistBlock = {
  date: string;
  startMinutes: number;
  durationMinutes: number;
  kind: string;
  subjectId: string | null;
  topicId: string | null;
  title: string | null;
  reason: string;
  origin: string;
};

async function persistDays(userId: string, blocks: PersistBlock[]) {
  const now = new Date().toISOString();
  for (const b of blocks) {
    await db.insert(planItems).values({
      id: uid(),
      userId,
      date: b.date,
      kind: b.kind as (typeof planItems)["$inferInsert"]["kind"],
      subjectId: b.subjectId,
      topicId: b.topicId,
      title: b.title ?? "",
      startMinutes: b.startMinutes,
      durationMinutes: b.durationMinutes,
      status: "pending",
      reason: b.reason,
      origin: b.origin,
      createdAt: now,
      updatedAt: now,
    });
  }
}

/**
 * Guarantees a plan exists for the upcoming window. Regenerates only when the
 * whole window is empty unless `force` is set — completed and skipped items
 * are never touched, and the generator never touches past days.
 */
export async function ensurePlan(userId: string, horizonDays = 7, force = false): Promise<number> {
  const pending = await countPendingFrom(userId, todayISO());
  if (pending > 0 && !force) return 0;

  const { availability, subjectMeta, engineSubjects, engineTopics, engineExams, engineTasks } =
    await buildEngineInput(userId);

  const missedRows = await db
    .select()
    .from(planItems)
    .where(and(eq(planItems.userId, userId), eq(planItems.status, "missed")))
    .all();
  const missed = missedRows
    .filter((m) => daysUntil(m.date) >= -7)
    .map((m) => ({ topicId: m.topicId, date: m.date, minutes: m.durationMinutes, title: m.title, subjectId: m.subjectId }));

  const result = generateSchedule({
    subjects: engineSubjects,
    topics: engineTopics,
    exams: engineExams,
    tasks: engineTasks,
    availability,
    horizonDays,
    fromDate: todayISO(),
    missed,
    subjectMeta,
  });

  if (force) {
    await db
      .delete(planItems)
      .where(
        and(
          eq(planItems.userId, userId),
          gte(planItems.date, todayISO()),
          inArray(planItems.status, ["pending", "skipped"]),
        ),
      )
      .run();
  }

  const blocks = result.days.flatMap((d) => d.blocks);
  await persistDays(userId, blocks);
  return blocks.filter((b) => b.kind !== "break").length;
}

export async function completePlanItem(userId: string, itemId: string): Promise<void> {
  const [item] = await db
    .select()
    .from(planItems)
    .where(and(eq(planItems.id, itemId), eq(planItems.userId, userId)))
    .limit(1)
    .all();
  if (!item || item.status === "completed") return;

  const now = new Date().toISOString();
  await db
    .update(planItems)
    .set({ status: "completed", completedAt: now, updatedAt: now })
    .where(eq(planItems.id, itemId))
    .run();

  if (item.topicId) {
    await db.update(topics).set({ lastStudiedAt: now, updatedAt: now }).where(eq(topics.id, item.topicId)).run();
  }
}

export async function skipPlanItem(userId: string, itemId: string): Promise<void> {
  await db
    .update(planItems)
    .set({ status: "skipped", updatedAt: new Date().toISOString() })
    .where(and(eq(planItems.id, itemId), eq(planItems.userId, userId)))
    .run();
}

/** Move a planned block a few days forward when the student genuinely can't do it. */
export async function postponePlanItem(userId: string, itemId: string, days = 1): Promise<boolean> {
  const [item] = await db
    .select()
    .from(planItems)
    .where(and(eq(planItems.id, itemId), eq(planItems.userId, userId)))
    .limit(1)
    .all();
  if (!item || item.status !== "pending") return false;

  const existing = await existingPlanSummary(userId);
  const res = await redistributeMissed({
    missed: [
      {
        planItemId: item.id,
        topicId: item.topicId,
        subjectId: item.subjectId,
        date: item.date,
        minutes: item.durationMinutes,
        title: item.topicId ? "" : item.title,
      },
    ],
    availability: await getAvailability(userId),
    existing,
    spreadDays: days,
    subjectMeta: await getSubjectMetaMap(userId),
    fromDate: addDaysISO(1, todayISO()),
  });

  if (!res.blocks.length) return false;
  await skipPlanItem(userId, item.id);
  await persistDays(userId, res.blocks);
  return true;
}

/** Redistribute everything the student missed in the last 7 days. */
export async function rescheduleMissedPlan(userId: string): Promise<{ moved: number; summary: string[] }> {
  const missedRows = await db
    .select()
    .from(planItems)
    .where(and(eq(planItems.userId, userId), eq(planItems.status, "missed")))
    .all();
  const recent = missedRows.filter((m) => daysUntil(m.date) >= -7);
  if (!recent.length) return { moved: 0, summary: [] };

  const blocks: MissedBlock[] = recent.map((m) => ({
    planItemId: m.id,
    topicId: m.topicId,
    subjectId: m.subjectId,
    date: m.date,
    minutes: m.durationMinutes,
    title: m.topicId ? "" : m.title,
  }));

  const res = await redistributeMissed({
    missed: blocks,
    availability: await getAvailability(userId),
    existing: await existingPlanSummary(userId),
    subjectMeta: await getSubjectMetaMap(userId),
    fromDate: todayISO(),
  });

  if (res.blocks.length) await persistDays(userId, res.blocks);

  return { moved: res.blocks.length, summary: res.summary.map((s) => s.reason) };
}

export type MovePlanResult = { ok: true; moved: boolean } | { ok: false; error: string };

/**
 * Drag-and-drop rescheduling: move one pending block to another day.
 * Keeps the engine's promises — never into the past, never double-booking a
 * topic on one day, never exceeding the day's real capacity.
 */
export async function movePlanItem(
  userId: string,
  itemId: string,
  targetDate: ISODate,
  startMinutes?: number,
): Promise<MovePlanResult> {
  const [item] = await db
    .select()
    .from(planItems)
    .where(and(eq(planItems.id, itemId), eq(planItems.userId, userId)))
    .limit(1)
    .all();
  if (!item) return { ok: false, error: "That block no longer exists." };
  if (item.kind === "break") return { ok: false, error: "Breaks are generated automatically and can't be moved." };
  if (item.status !== "pending") {
    return { ok: false, error: `Only upcoming blocks can be moved — this one is already ${item.status}.` };
  }
  if (isPast(targetDate)) return { ok: false, error: "You can't move a block into the past." };

  const wantsTimeChange = startMinutes !== undefined && startMinutes !== item.startMinutes;
  if (item.date === targetDate && !wantsTimeChange) return { ok: true, moved: false };

  // Time validation: must fit inside the day and not run past midnight.
  const newStart = wantsTimeChange ? (startMinutes as number) : item.startMinutes;
  if (newStart < 0 || newStart + item.durationMinutes > 24 * 60) {
    return { ok: false, error: "That start time doesn't fit the block's length inside the day." };
  }

  const summary = await existingPlanSummary(userId);
  const entry = summary.get(targetDate);
  if (item.topicId && entry?.topicKeys.has(item.topicId) && item.date !== targetDate) {
    return { ok: false, error: "That topic is already scheduled on this day — one pass per topic per day keeps days balanced." };
  }

  // Overlap check against the target day's pending blocks (time placement).
  const dayItems = await db
    .select()
    .from(planItems)
    .where(and(eq(planItems.userId, userId), eq(planItems.date, targetDate), eq(planItems.status, "pending")))
    .all();
  const newEnd = newStart + item.durationMinutes;
  for (const p of dayItems) {
    if (p.id === itemId || p.kind === "break") continue;
    if (newStart < p.startMinutes + p.durationMinutes && p.startMinutes < newEnd) {
      return {
        ok: false,
        error: `That time overlaps "${p.title ?? "another block"}" (${String(Math.floor(p.startMinutes / 60)).padStart(2, "0")}:${String(p.startMinutes % 60).padStart(2, "0")}). Pick a free slot.`,
      };
    }
  }

  const availability = await getAvailability(userId);
  const cap = dayCapacityMinutes(availability, targetDate);
  // Same-day time changes must not double-count the block's own duration.
  const used = (entry?.usedMinutes ?? 0) - (targetDate === item.date ? item.durationMinutes : 0);
  const capH = Math.round((cap / 60) * 10) / 10;
  const usedH = Math.round((used / 60) * 10) / 10;
  if (used + item.durationMinutes > cap) {
    return {
      ok: false,
      error: `That day is already near full (${usedH}h of ~${capH}h planned). Pick a lighter day or free a slot first.`,
    };
  }

  await db
    .update(planItems)
    .set({
      date: targetDate,
      ...(wantsTimeChange ? { startMinutes: newStart } : {}),
      origin: "rescheduled",
      updatedAt: new Date().toISOString(),
    })
    .where(eq(planItems.id, itemId))
    .run();
  return { ok: true, moved: true };
}

export async function existingPlanSummary(userId: string): Promise<Map<ISODate, ExistingPlanSummary>> {
  const from = todayISO();
  const rows = await db
    .select()
    .from(planItems)
    .where(and(eq(planItems.userId, userId), eq(planItems.status, "pending"), gte(planItems.date, from)))
    .all();
  const map = new Map<ISODate, ExistingPlanSummary>();
  for (const r of rows) {
    if (r.kind === "break") continue;
    const entry = map.get(r.date) ?? { date: r.date, usedMinutes: 0, lastEndMinutes: -1, topicKeys: new Set<string>() };
    entry.usedMinutes += r.durationMinutes;
    entry.lastEndMinutes = Math.max(entry.lastEndMinutes, r.startMinutes + r.durationMinutes);
    if (r.topicId) entry.topicKeys.add(r.topicId);
    map.set(r.date, entry);
  }
  return map;
}

export type { MissedBlock };
