import { and, count, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db, uid } from "@/lib/db";
import {
  achievements,
  exams,
  notifications,
  planItems,
  studySessions,
  subjects,
  tasks,
  topics,
  units,
  userAchievements,
} from "@/lib/db/schema";
import { addDaysISO, daysUntil, todayISO } from "@/lib/dates";
import { examRoadmap } from "@/lib/engine/roadmap";
import { getProfileBundle } from "./data";
import type { EngineTopic } from "@/lib/engine/types";

export type NotificationType = "session" | "missed_task" | "deadline" | "exam" | "daily_plan" | "streak" | "ai_recommendation" | "achievement";

export async function createNotification(
  userId: string,
  type: NotificationType,
  title: string,
  body?: string,
): Promise<void> {
  await db.insert(notifications).values({ id: uid(), userId, type, title, body, read: false });
}

async function ensureAchievementCatalog(): Promise<void> {
  const [{ c }] = await db.select({ c: count() }).from(achievements).all();
  if (c > 0) return;
  const { ACHIEVEMENT_DEFS } = await import("@/lib/db/achievements");
  for (const def of ACHIEVEMENT_DEFS) {
    await db
      .insert(achievements)
      .values({
        id: `ach-${def.code}`,
        code: def.code,
        title: def.title,
        description: def.description,
        icon: def.icon,
        category: def.category,
        target: def.target,
        tier: def.tier,
      })
      .onConflictDoNothing({ target: achievements.code });
  }
}

/**
 * Recomputes every achievement from actual data. Deterministic — the same
 * state always produces the same progress. Newly unlocked achievements create
 * notifications and are returned so the UI can celebrate.
 */
export async function refreshAchievements(userId: string): Promise<{ code: string; title: string }[]> {
  await ensureAchievementCatalog();
  const today = todayISO();
  const profile = await getProfileBundle(userId);
  const goal = profile?.dailyGoalMinutes ?? 240;

  /* streak — consecutive days with at least one completed session */
  const sessionDates = await db
    .select({ startedAt: studySessions.startedAt })
    .from(studySessions)
    .where(and(eq(studySessions.userId, userId), eq(studySessions.completed, true)))
    .all();
  const studied = new Set(sessionDates.map((s) => s.startedAt.slice(0, 10)));
  let streak = 0;
  let cursor = today;
  if (!studied.has(cursor)) cursor = addDaysISO(-1, cursor);
  while (studied.has(cursor)) {
    streak++;
    cursor = addDaysISO(-1, cursor);
  }

  /* completed tasks */
  const [{ c: taskDone }] = await db
    .select({ c: count() })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), eq(tasks.status, "completed")))
    .all();

  /* total study minutes = completed sessions + plan blocks completed without a session */
  const [{ total: sessionsMin }] = await db
    .select({ total: sql<number>`coalesce(sum(${studySessions.durationMinutes}), 0)` })
    .from(studySessions)
    .where(and(eq(studySessions.userId, userId), eq(studySessions.completed, true)))
    .all();
  const [{ total: orphanPlanMin }] = await db
    .select({ total: sql<number>`coalesce(sum(${planItems.durationMinutes}), 0)` })
    .from(planItems)
    .leftJoin(studySessions, eq(studySessions.planItemId, planItems.id))
    .where(
      and(
        eq(planItems.userId, userId),
        eq(planItems.status, "completed"),
        isNull(studySessions.id),
        eq(planItems.kind, "study"),
      ),
    )
    .all();
  const totalMinutes = Number(sessionsMin ?? 0) + Number(orphanPlanMin ?? 0);

  /* focus session count + early/night birds */
  const focusRows = await db
    .select({ startedAt: studySessions.startedAt })
    .from(studySessions)
    .where(and(eq(studySessions.userId, userId), eq(studySessions.completed, true), eq(studySessions.kind, "focus")))
    .all();
  const earlyBird = focusRows.filter((s) => new Date(s.startedAt).getHours() < 8).length;
  const nightOwl = focusRows.filter((s) => new Date(s.startedAt).getHours() >= 22).length;

  /* per-day effort over the last 7 days */
  const weekAgo = addDaysISO(-6, today);
  const recentSessions = await db
    .select({ startedAt: studySessions.startedAt, durationMinutes: studySessions.durationMinutes })
    .from(studySessions)
    .where(
      and(
        eq(studySessions.userId, userId),
        eq(studySessions.completed, true),
        gte(studySessions.startedAt, `${weekAgo}T00:00:00`),
      ),
    )
    .all();
  const daily = new Map<string, number>();
  for (const s of recentSessions) {
    const d = s.startedAt.slice(0, 10);
    daily.set(d, (daily.get(d) ?? 0) + s.durationMinutes);
  }
  const recentPlan = await db
    .select()
    .from(planItems)
    .where(and(eq(planItems.userId, userId), gte(planItems.date, weekAgo), lte(planItems.date, today)))
    .all();
  for (const p of recentPlan) {
    if (p.status === "completed" && p.durationMinutes) {
      daily.set(p.date, (daily.get(p.date) ?? 0) + p.durationMinutes);
    }
  }
  let perfectDays = 0;
  for (let i = 0; i < 7; i++) {
    if ((daily.get(addDaysISO(-i, today)) ?? 0) >= goal) perfectDays++;
  }

  /* today's plan fully completed */
  const todayItems = await db
    .select()
    .from(planItems)
    .where(and(eq(planItems.userId, userId), eq(planItems.date, today), eq(planItems.kind, "study")))
    .all();
  const planDone = todayItems.length > 0 && todayItems.every((p) => p.status === "completed");

  /* fully completed subjects */
  const subjectRows = await db.select().from(subjects).where(eq(subjects.userId, userId)).all();
  const unitRows = await db.select().from(units).where(inArray(units.subjectId, subjectRows.map((s) => s.id))).all();
  const topicRows = await db
    .select()
    .from(topics)
    .where(inArray(topics.unitId, unitRows.map((u) => u.id)))
    .all();
  const unitSubject = new Map(unitRows.map((u) => [u.id, u.subjectId]));
  let subjectsCompleted = 0;
  const completedBySubject = new Map<string, number>();
  const totalBySubject = new Map<string, number>();
  for (const t of topicRows) {
    const sid = unitSubject.get(t.unitId);
    if (!sid) continue;
    totalBySubject.set(sid, (totalBySubject.get(sid) ?? 0) + 1);
    if (t.status === "completed") completedBySubject.set(sid, (completedBySubject.get(sid) ?? 0) + 1);
  }
  for (const s of subjectRows) {
    const total = totalBySubject.get(s.id) ?? 0;
    if (total > 0 && (completedBySubject.get(s.id) ?? 0) === total) subjectsCompleted++;
  }

  /* exam readiness >= 80 for any upcoming exam */
  const examRows = await db.select().from(exams).where(eq(exams.userId, userId)).all();
  let anyExamReady = false;
  for (const ex of examRows) {
    if (daysUntil(ex.date) < 0) continue;
    const engineTopics = getTopicsForExam(ex.subjectId, unitRows, topicRows);
    void engineTopics;
    const roadmap = examRoadmap({
      exam: { id: ex.id, subjectId: ex.subjectId ?? null, name: ex.name, date: ex.date, importance: ex.importance },
      subject: ex.subjectId ? subjectMeta(ex.subjectId, subjectRows) : null,
      subjectColor: null,
      topics: engineTopics,
      availability: {
        weekdayHours: profile?.weekdayHours ?? 3,
        weekendHours: profile?.weekendHours ?? 5,
        preferredTimes: profile?.preferredTimes ?? [],
        sessionStyle: profile?.sessionStyle ?? "mixed",
      },
      today,
    });
    if (roadmap.readiness >= 80) anyExamReady = true;
  }

  const values: Record<string, number> = {
    streak_3: streak, streak_7: streak, streak_14: streak, streak_30: streak,
    tasks_10: taskDone ?? 0, tasks_50: taskDone ?? 0, tasks_100: taskDone ?? 0,
    hours_5: totalMinutes, hours_25: totalMinutes, hours_100: totalMinutes, hours_500: totalMinutes,
    focus_10: focusRows.length, focus_50: focusRows.length, pomodoro_25: focusRows.length,
    perfect_week: perfectDays, early_bird: earlyBird, night_owl: nightOwl,
    plan_complete: planDone ? 1 : 0,
    exam_ready: anyExamReady ? 1 : 0,
    subject_first: subjectsCompleted > 0 ? 1 : 0,
    subject_all: subjectsCompleted > 0 && subjectsCompleted === subjectRows.length ? 1 : 0,
  };

  const defRows = await db.select().from(achievements).all();
  const progressRows = await db.select().from(userAchievements).where(eq(userAchievements.userId, userId)).all();
  const progressByCode = new Map(progressRows.map((r) => [r.achievementId, r]));
  const unlockedNew: { code: string; title: string }[] = [];

  for (const def of defRows) {
    const progress = Math.min(def.target, values[def.code] ?? 0);
    const row = progressByCode.get(def.id);
    const already = row?.progress ?? 0;
    const isUnlocked = Boolean(row?.unlockedAt);
    if (row) {
      if (already !== progress) {
        await db
          .update(userAchievements)
          .set({ progress })
          .where(and(eq(userAchievements.userId, userId), eq(userAchievements.achievementId, def.id)))
          .run();
      }
    } else {
      await db.insert(userAchievements).values({ userId, achievementId: def.id, progress });
    }

    if (!isUnlocked && progress >= def.target) {
      const now = new Date().toISOString();
      await db
        .update(userAchievements)
        .set({ progress, unlockedAt: now })
        .where(and(eq(userAchievements.userId, userId), eq(userAchievements.achievementId, def.id)))
        .run();
      unlockedNew.push({ code: def.code, title: def.title });
      await createNotification(userId, "achievement", `Achievement unlocked: ${def.title}`, def.description);
    }
  }

  return unlockedNew;
}

/* helpers used above */
function subjectMeta(subjectId: string, rows: { id: string; name: string; priority: number; difficulty: number }[]) {
  const s = rows.find((r) => r.id === subjectId);
  return s ? { id: s.id, name: s.name, priority: s.priority, difficulty: s.difficulty } : null;
}

function getTopicsForExam(
  subjectId: string | null,
  unitRows: { id: string; subjectId: string }[],
  topicRows: { id: string; unitId: string; name: string; difficulty: number; weight: number; status: EngineTopic["status"]; sortOrder: number }[],
): EngineTopic[] {
  const subjectUnitIds = unitRows.filter((u) => u.subjectId === subjectId).map((u) => u.id);
  const unitOrder = new Map(unitRows.map((u, i) => [u.id, i]));
  return topicRows
    .filter((t) => subjectUnitIds.includes(t.unitId))
    .map((t) => ({
      id: t.id,
      subjectId: subjectId ?? "",
      unitId: t.unitId,
      name: t.name,
      difficulty: t.difficulty,
      weight: t.weight,
      status: t.status,
      unitOrder: unitOrder.get(t.unitId) ?? 0,
      topicOrder: t.sortOrder,
      lastStudiedAt: null,
    }));
}
