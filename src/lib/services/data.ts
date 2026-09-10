import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  aiRecommendations,
  achievements,
  exams,
  notifications,
  planItems,
  profiles,
  settings,
  studySessions,
  subjects,
  tasks,
  topics,
  units,
  userAchievements,
  users,
  type Exam,
  type Subject,
  type Task,
  type Topic,
  type Unit,
} from "@/lib/db/schema";
import { addDaysISO, daysUntil, todayISO, type ISODate } from "@/lib/dates";
import { examRoadmap } from "@/lib/engine/roadmap";
import { currentStreak, longestStreak } from "@/lib/engine/stats";
import type {
  AchievementState,
  AppData,
  AppUserProfile,
  ExamAgg,
  PlanDayAgg,
  PlanItemAgg,
  SubjectAgg,
  TaskAgg,
  TopicAgg,
  UnitAgg,
} from "./types";

const TOPIC_CREDIT: Record<string, number> = {
  not_started: 0,
  learning: 0.45,
  completed: 1,
  needs_revision: 1,
};

type Availability = {
  weekdayHours: number;
  weekendHours: number;
  preferredTimes: string[];
  sessionStyle: string;
};

/* ── User bundle ─────────────────────────────────────────────── */
export async function getProfileBundle(userId: string): Promise<AppUserProfile | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1).all();
  if (!user) return null;
  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1).all();
  const [setting] = await db.select().from(settings).where(eq(settings.userId, userId)).limit(1).all();

  const parseJson = <T>(raw: string | null | undefined, fallback: T): T => {
    if (!raw) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  };

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    onboarded: user.onboarded,
    educationLevel: profile?.educationLevel ?? null,
    course: profile?.course ?? null,
    yearOfStudy: profile?.yearOfStudy ?? null,
    studyGoals: profile?.studyGoals ?? null,
    weekdayHours: profile?.weekdayHours ?? 3,
    weekendHours: profile?.weekendHours ?? 5,
    preferredTimes: parseJson<string[]>(profile?.preferredTimes, []),
    sessionStyle: profile?.sessionStyle ?? "mixed",
    theme: setting?.theme ?? "system",
    dailyGoalMinutes: setting?.dailyGoalMinutes ?? 240,
    focusMinutes: setting?.focusMinutes ?? 25,
    breakMinutes: setting?.breakMinutes ?? 5,
    notificationPrefs: parseJson<Record<string, boolean>>(setting?.notificationPrefs, {}),
  };
}

/* ── Subjects & syllabus ─────────────────────────────────────── */
export async function getSubjectRows(userId: string): Promise<Subject[]> {
  return db
    .select()
    .from(subjects)
    .where(and(eq(subjects.userId, userId), sql`${subjects.deletedAt} is null`))
    .orderBy(asc(subjects.sortOrder))
    .all();
}

export async function getUnitsForSubjects(subjectIds: string[]): Promise<Unit[]> {
  if (!subjectIds.length) return [];
  return db.select().from(units).where(inArray(units.subjectId, subjectIds)).orderBy(asc(units.sortOrder)).all();
}

export async function getTopicsForUnits(unitIds: string[]): Promise<Topic[]> {
  if (!unitIds.length) return [];
  return db.select().from(topics).where(inArray(topics.unitId, unitIds)).orderBy(asc(topics.sortOrder)).all();
}

export function groupTopicsByUnit(unitRows: Unit[], topicRows: Topic[]): UnitAgg[] {
  const byUnit = new Map<string, Topic[]>();
  for (const t of topicRows) {
    byUnit.set(t.unitId, [...(byUnit.get(t.unitId) ?? []), t]);
  }
  return unitRows.map((u) => ({
    id: u.id,
    name: u.name,
    sortOrder: u.sortOrder,
    topics: (byUnit.get(u.id) ?? [])
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((t) => ({
        id: t.id,
        name: t.name,
        unitId: u.id,
        unitName: u.name,
        description: t.description,
        difficulty: t.difficulty,
        weight: t.weight,
        status: t.status,
        sortOrder: t.sortOrder,
      })),
  }));
}

export function subjectProgress(flat: TopicAgg[]): { progress: number; completedTopics: number; weak: TopicAgg[]; estimatedHours: number } {
  let weight = 0;
  let credit = 0;
  let completed = 0;
  let hoursLeft = 0;
  const weak: TopicAgg[] = [];
  for (const t of flat) {
    weight += t.weight;
    credit += t.weight * TOPIC_CREDIT[t.status];
    if (t.status === "completed") completed++;
    if (t.status === "needs_revision") weak.push(t);
    // Unfinished topics carry remaining study time: difficulty 1..5 maps
    // to a 1..4 hour band (learning topics count at half weight).
    if (t.status !== "completed") {
      const base = 0.5 + t.difficulty * 0.7; // ≈1.2h..4h
      hoursLeft += base * (t.status === "learning" ? 0.5 : 1);
    }
  }
  return {
    progress: weight > 0 ? Math.round((credit / weight) * 100) : 0,
    completedTopics: completed,
    weak: weak.sort((a, b) => b.difficulty - a.difficulty).slice(0, 4),
    estimatedHours: Math.round(hoursLeft * 10) / 10,
  };
}

/* ── Exams with readiness ────────────────────────────────────── */
export async function getExamRows(userId: string): Promise<Exam[]> {
  return db.select().from(exams).where(eq(exams.userId, userId)).orderBy(asc(exams.date)).all();
}

export async function buildExamAggs(
  userId: string,
  subjectById: Map<string, Subject>,
  topicAggsBySubject: Map<string, TopicAgg[]>,
  availability: Availability,
): Promise<ExamAgg[]> {
  const examRows = await getExamRows(userId);
  const today = todayISO();

  return examRows.map((ex: Exam) => {
    const subject = ex.subjectId ? subjectById.get(ex.subjectId) : undefined;
    const aggTopics = ex.subjectId ? topicAggsBySubject.get(ex.subjectId) ?? [] : [];
    const engineTopics = aggTopics.map((t) => ({
      id: t.id,
      subjectId: ex.subjectId ?? "",
      unitId: t.unitId,
      name: t.name,
      difficulty: t.difficulty,
      weight: t.weight,
      status: t.status,
      unitOrder: 0,
      topicOrder: t.sortOrder,
      lastStudiedAt: null,
    }));
    const roadmap = examRoadmap({
      exam: {
        id: ex.id,
        subjectId: ex.subjectId ?? null,
        name: ex.name,
        date: ex.date,
        importance: ex.importance,
      },
      subject: subject
        ? { id: subject.id, name: subject.name, priority: subject.priority, difficulty: subject.difficulty }
        : null,
      subjectColor: subject?.color ?? null,
      topics: engineTopics,
      availability,
      today,
    });
    return { ...roadmap, id: ex.id, subjectName: subject?.name ?? null, subjectColor: subject?.color ?? null };
  });
}

/* ── Tasks ───────────────────────────────────────────────────── */
export async function getTaskAggs(userId: string, subjectById?: Map<string, Subject>): Promise<TaskAgg[]> {
  const rows = await db
    .select()
    .from(tasks)
    .where(eq(tasks.userId, userId))
    .orderBy(asc(tasks.deadline), asc(tasks.priority))
    .all();
  return rows.map((t: Task) => ({
    id: t.id,
    title: t.title,
    kind: t.kind,
    deadline: t.deadline,
    daysLeft: t.deadline ? daysUntil(t.deadline) : null,
    priority: t.priority,
    estimatedMinutes: t.estimatedMinutes,
    status: t.status,
    notes: t.notes,
    subjectId: t.subjectId,
    subjectName: t.subjectId && subjectById ? subjectById.get(t.subjectId)?.name ?? null : null,
    subjectColor: t.subjectId && subjectById ? subjectById.get(t.subjectId)?.color ?? null : null,
  }));
}

/* ── Plan ────────────────────────────────────────────────────── */
function planRowToAgg(
  p: typeof planItems.$inferSelect,
  subjectById?: Map<string, Subject>,
  topicById?: Map<string, Topic>,
): PlanItemAgg {
  return {
    id: p.id,
    date: p.date,
    kind: p.kind,
    title: p.title,
    startMinutes: p.startMinutes,
    durationMinutes: p.durationMinutes,
    status: p.status,
    reason: p.reason,
    origin: p.origin,
    subjectId: p.subjectId,
    subjectName: p.subjectId && subjectById ? subjectById.get(p.subjectId)?.name ?? null : null,
    subjectColor: p.subjectId && subjectById ? subjectById.get(p.subjectId)?.color ?? null : null,
    topicId: p.topicId,
    topicName: p.topicId && topicById ? topicById.get(p.topicId)?.name ?? null : null,
    topicStatus: p.topicId && topicById ? topicById.get(p.topicId)?.status ?? null : null,
    completedAt: p.completedAt,
  };
}

export async function finalizePastPlanItems(userId: string): Promise<number> {
  const today = todayISO();
  const res = await db
    .update(planItems)
    .set({ status: "missed", updatedAt: new Date().toISOString() })
    .where(and(eq(planItems.userId, userId), eq(planItems.status, "pending"), lt(planItems.date, today)))
    .run();
  return res.changes;
}

export async function getPlanDays(
  userId: string,
  subjectById?: Map<string, Subject>,
  topicById?: Map<string, Topic>,
): Promise<PlanDayAgg[]> {
  const today = todayISO();
  const rows = await db
    .select()
    .from(planItems)
    .where(and(eq(planItems.userId, userId), gte(planItems.date, today)))
    .orderBy(asc(planItems.date), asc(planItems.startMinutes))
    .all();

  const byDate = new Map<string, PlanItemAgg[]>();
  for (const p of rows) {
    const item = planRowToAgg(p, subjectById, topicById);
    byDate.set(item.date, [...(byDate.get(item.date) ?? []), item]);
  }

  const out: PlanDayAgg[] = [];
  for (const [date, items] of byDate) {
    const studyItems = items.filter((i) => i.kind !== "break");
    out.push({
      date,
      items,
      plannedMinutes: studyItems.reduce((a, i) => a + i.durationMinutes, 0),
      completedMinutes: studyItems.filter((i) => i.status === "completed").reduce((a, i) => a + i.durationMinutes, 0),
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/* ── Calendar ────────────────────────────────────────────────── */
export type CalendarExamEvent = {
  id: string;
  name: string;
  date: ISODate;
  subjectName: string | null;
  subjectColor: string | null;
};

/**
 * Events for the calendar surface: plan blocks from ~6 weeks back (so
 * completed/missed history shows) through the future, all tasks, all exams.
 * Study blocks only exist for the rolling window the planner has generated —
 * future days fill in as the plan rolls forward or via drag-and-drop.
 */
export async function loadCalendarData(userId: string): Promise<{
  plan: PlanItemAgg[];
  tasks: TaskAgg[];
  exams: CalendarExamEvent[];
}> {
  const subjectRows = await getSubjectRows(userId);
  const subjectById = new Map(subjectRows.map((s) => [s.id, s]));
  const unitRows = await getUnitsForSubjects(subjectRows.map((s) => s.id));
  const topicRows = await getTopicsForUnits(unitRows.map((u) => u.id));
  const topicById = new Map(topicRows.map((t) => [t.id, t]));

  const planRows = await db
    .select()
    .from(planItems)
    .where(and(eq(planItems.userId, userId), gte(planItems.date, addDaysISO(-45))))
    .orderBy(asc(planItems.date), asc(planItems.startMinutes))
    .all();

  const examRows = await getExamRows(userId);
  return {
    plan: planRows.map((p) => planRowToAgg(p, subjectById, topicById)),
    tasks: await getTaskAggs(userId, subjectById),
    exams: examRows.map((e) => ({
      id: e.id,
      name: e.name,
      date: e.date,
      subjectName: e.subjectId ? subjectById.get(e.subjectId)?.name ?? null : null,
      subjectColor: e.subjectId ? subjectById.get(e.subjectId)?.color ?? null : null,
    })),
  };
}

/* ── Study sessions & streaks ────────────────────────────────── */
export async function studiedDates(userId: string): Promise<Set<ISODate>> {
  const rows = await db
    .select({ startedAt: studySessions.startedAt })
    .from(studySessions)
    .where(and(eq(studySessions.userId, userId), eq(studySessions.completed, true)))
    .all();
  const set = new Set<ISODate>();
  for (const r of rows) {
    set.add(r.startedAt.slice(0, 10));
  }
  return set;
}

export async function getStreaks(userId: string): Promise<{ current: number; longest: number }> {
  const dates = await studiedDates(userId);
  return { current: currentStreak(dates, todayISO()), longest: longestStreak(dates) };
}

/* ── Achievements ────────────────────────────────────────────── */
export async function getAchievementStates(userId: string): Promise<AchievementState[]> {
  const defs = await db.select().from(achievements).orderBy(asc(achievements.tier)).all();
  const progressRows = await db.select().from(userAchievements).where(eq(userAchievements.userId, userId)).all();
  const byCode = new Map(progressRows.map((r) => [r.achievementId, r]));

  return defs.map((d) => {
    const row = byCode.get(d.id);
    return {
      code: d.code,
      title: d.title,
      description: d.description,
      icon: d.icon,
      category: d.category,
      target: d.target,
      progress: row?.progress ?? 0,
      unlocked: Boolean(row?.unlockedAt),
      unlockedAt: row?.unlockedAt ?? null,
    };
  });
}

/* ── Notifications ───────────────────────────────────────────── */
export async function getUnreadNotifications(userId: string, limit = 10) {
  return db
    .select({
      id: notifications.id,
      type: notifications.type,
      title: notifications.title,
      body: notifications.body,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.read, false)))
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .all();
}

export async function getLatestAiRecommendations(userId: string, limit = 3) {
  return db
    .select()
    .from(aiRecommendations)
    .where(eq(aiRecommendations.userId, userId))
    .orderBy(desc(aiRecommendations.createdAt))
    .limit(limit)
    .all();
}

/* ── Master loader ───────────────────────────────────────────── */
export async function getAppData(userId: string): Promise<AppData> {
  const profile = await getProfileBundle(userId);
  if (!profile) throw new Error("User not found");

  await finalizePastPlanItems(userId);

  const subjectRows = await getSubjectRows(userId);
  const subjectById = new Map(subjectRows.map((s) => [s.id, s]));
  const unitRows = await getUnitsForSubjects(subjectRows.map((s) => s.id));
  const topicRows = await getTopicsForUnits(unitRows.map((u) => u.id));
  const topicById = new Map(topicRows.map((t) => [t.id, t]));

  const unitAggs = groupTopicsByUnit(unitRows, topicRows);
  const unitSubject = new Map(unitRows.map((u) => [u.id, u.subjectId]));
  const perSubjectUnits = new Map<string, UnitAgg[]>();
  for (const u of unitAggs) {
    const sid = unitSubject.get(u.id);
    if (!sid) continue;
    perSubjectUnits.set(sid, [...(perSubjectUnits.get(sid) ?? []), u]);
  }

  const examRows = await getExamRows(userId);
  const examBySubject = new Map(examRows.filter((e) => e.subjectId !== null).map((e) => [e.subjectId as string, e]));

  const topicAggsBySubject = new Map<string, TopicAgg[]>();
  const subjectsOut: SubjectAgg[] = subjectRows.map((s: Subject) => {
    const aggs = perSubjectUnits.get(s.id) ?? [];
    const flat: TopicAgg[] = aggs.flatMap((u) => u.topics);
    topicAggsBySubject.set(s.id, flat);
    const { progress, completedTopics, weak, estimatedHours } = subjectProgress(flat);
    const examRow = examBySubject.get(s.id);
    return {
      id: s.id,
      name: s.name,
      color: s.color,
      priority: s.priority,
      difficulty: s.difficulty,
      progress,
      completedTopics,
      totalTopics: flat.length,
      estimatedHours,
      units: aggs,
      weakTopics: weak.map((w) => ({ id: w.id, name: w.name, difficulty: w.difficulty })),
      exam: examRow
        ? { id: examRow.id, name: examRow.name, date: examRow.date, daysLeft: daysUntil(examRow.date) }
        : null,
    };
  });

  const examAggs = await buildExamAggs(userId, subjectById, topicAggsBySubject, {
    weekdayHours: profile.weekdayHours,
    weekendHours: profile.weekendHours,
    preferredTimes: profile.preferredTimes,
    sessionStyle: profile.sessionStyle,
  });

  const taskAggs = await getTaskAggs(userId, subjectById);
  const planDays = await getPlanDays(userId, subjectById, topicById);
  const today = todayISO();
  const todayPlan = planDays.find((d) => d.date === today) ?? null;
  const { current, longest } = await getStreaks(userId);
  const achievementStates = await getAchievementStates(userId);
  const unread = await getUnreadNotifications(userId);

  return {
    user: profile,
    subjects: subjectsOut,
    exams: examAggs,
    tasks: taskAggs,
    plan: planDays,
    today: todayPlan,
    streak: current,
    longestStreak: longest,
    achievements: achievementStates,
    unlockedCount: achievementStates.filter((a) => a.unlocked).length,
    unreadNotifications: unread,
  };
}
