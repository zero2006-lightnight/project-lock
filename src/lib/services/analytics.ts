import { and, count, eq, gte, isNotNull, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { planItems, studySessions, topics, units, tasks, exams } from "@/lib/db/schema";
import { addDaysISO, todayISO } from "@/lib/dates";
import { currentStreak, longestStreak, productiveHourRange } from "@/lib/engine/stats";
import { generateInsights, type GeneratedInsight } from "@/lib/engine/insights";
import { getAppData, getProfileBundle, getSubjectRows } from "./data";

export type WeekPoint = { label: string; minutes: number; goal: number; date: string };
export type SubjectShare = { name: string; color: string; minutes: number };
export type DailyCell = { date: string; minutes: number };

export type AnalyticsResult = {
  totalMinutes: number;
  weeklyAverageMinutes: number;
  completionRate: number;
  avgSessionMinutes: number;
  currentStreak: number;
  longestStreak: number;
  missed7: number;
  week: WeekPoint[];
  subjectShare: SubjectShare[];
  heatmap: DailyCell[];
  dailyGoalMinutes: number;
  insights: GeneratedInsight[];
  sessionCount: number;
  totalTasks: number;
  completedTasks: number;
};

export async function getAnalytics(userId: string): Promise<AnalyticsResult> {
  const today = todayISO();
  const profile = await getProfileBundle(userId);
  const goal = profile?.dailyGoalMinutes ?? 240;

  const sessions = await db
    .select({
      startedAt: studySessions.startedAt,
      durationMinutes: studySessions.durationMinutes,
      subjectId: studySessions.subjectId,
      completed: studySessions.completed,
    })
    .from(studySessions)
    .where(eq(studySessions.userId, userId))
    .all();
  const completedSessions = sessions.filter((s) => s.completed);

  const totalMinutes = completedSessions.reduce((a, s) => a + s.durationMinutes, 0);
  const avgSessionMinutes = completedSessions.length
    ? Math.round(totalMinutes / completedSessions.length)
    : 0;

  /* last 8 weeks of minutes (this week includes today) */
  const week: WeekPoint[] = [];
  for (let w = 7; w >= 0; w--) {
    const start = addDaysISO(-w * 7 - 6, today);
    const end = addDaysISO(-w * 7, today);
    const min = completedSessions
      .filter((s) => {
        const d = s.startedAt.slice(0, 10);
        return d >= start && d <= end;
      })
      .reduce((a, s) => a + s.durationMinutes, 0);
    week.push({
      label: `W-${w === 0 ? "this" : String(w)}`,
      minutes: min,
      goal: goal * (w === 0 ? todayDayIndex() : 7),
      date: start,
    });
  }
  const last7 = week[7]?.minutes ?? 0;
  const weeklyAverageMinutes = Math.round(last7 / Math.max(1, Math.min(7, todayDayIndex())));

  /* heatmap: 84 days */
  const heatmap: DailyCell[] = [];
  for (let i = 83; i >= 0; i--) {
    const d = addDaysISO(-i, today);
    const min = completedSessions
      .filter((s) => s.startedAt.slice(0, 10) === d)
      .reduce((a, s) => a + s.durationMinutes, 0);
    heatmap.push({ date: d, minutes: min });
  }

  /* subject time share */
  const subjectRows = await getSubjectRows(userId);
  const nameById = new Map(subjectRows.map((s) => [s.id, s.name]));
  const colorById = new Map(subjectRows.map((s) => [s.id, s.color]));
  const shareBySubject = new Map<string, number>();
  let unassigned = 0;
  for (const s of completedSessions) {
    if (s.subjectId && nameById.has(s.subjectId)) {
      shareBySubject.set(s.subjectId, (shareBySubject.get(s.subjectId) ?? 0) + s.durationMinutes);
    } else {
      unassigned += s.durationMinutes;
    }
  }
  const subjectShare: SubjectShare[] = [...shareBySubject.entries()]
    .map(([sid, minutes]) => ({ name: nameById.get(sid) ?? "Unknown", color: colorById.get(sid) ?? "#8b8fa3", minutes }))
    .sort((a, b) => b.minutes - a.minutes);
  if (unassigned > 0) subjectShare.push({ name: "General", color: "#8b8fa3", minutes: unassigned });

  /* plan completion rate this week */
  const weekStart = addDaysISO(-6, today);
  const planRows = await db
    .select()
    .from(planItems)
    .where(and(eq(planItems.userId, userId), gte(planItems.date, weekStart), lt(planItems.date, addDaysISO(1, today))))
    .all();
  const studyPlan = planRows.filter((p) => p.kind !== "break");
  const completedPlan = studyPlan.filter((p) => p.status === "completed").length;
  const completionRate = studyPlan.length ? Math.round((completedPlan / studyPlan.length) * 100) : 0;

  const [{ c: missed7 }] = await db
    .select({ c: count() })
    .from(planItems)
    .where(and(eq(planItems.userId, userId), eq(planItems.status, "missed"), gte(planItems.date, weekStart)))
    .all();

  const studiedDates = new Set(completedSessions.map((s) => s.startedAt.slice(0, 10)));
  const productiveRange = productiveHourRange(
    completedSessions.map((s) => ({ startedAt: s.startedAt, durationMinutes: s.durationMinutes })),
  );

  /* subject trends for insights (this week vs last week per subject) */
  const lastWeekStart = addDaysISO(-13, today);
  const lastWeekEnd = addDaysISO(-7, today);
  const subjectTrends = subjectRows.map((s) => {
    const thisWeekMinutes = completedSessions
      .filter((x) => x.subjectId === s.id && x.startedAt.slice(0, 10) >= weekStart)
      .reduce((a, x) => a + x.durationMinutes, 0);
    const lastWeekMinutes = completedSessions
      .filter((x) => x.subjectId === s.id && x.startedAt.slice(0, 10) >= lastWeekStart && x.startedAt.slice(0, 10) <= lastWeekEnd)
      .reduce((a, x) => a + x.durationMinutes, 0);
    return { subjectId: s.id, name: s.name, color: s.color, thisWeekMinutes, lastWeekMinutes, examDaysLeft: null as number | null, syllabusPercent: 0 };
  });

  const data = await getAppData(userId);
  const subjectById = new Map(subjectRows.map((s) => [s.id, s]));
  for (const agg of data.subjects) {
    const t = subjectTrends.find((x) => x.subjectId === agg.id);
    if (t) {
      t.syllabusPercent = agg.progress;
      t.examDaysLeft = agg.exam?.daysLeft ?? null;
    }
  }

  const [{ c: sessionCount }] = await db
    .select({ c: count() })
    .from(studySessions)
    .where(and(eq(studySessions.userId, userId), eq(studySessions.completed, true)))
    .all();
  const [{ c: totalTasks }] = await db.select({ c: count() }).from(tasks).where(eq(tasks.userId, userId)).all();
  const [{ c: completedTasks }] = await db
    .select({ c: count() })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), eq(tasks.status, "completed")))
    .all();

  const insights = generateInsights({
    userName: profile?.name ?? "there",
    streak: currentStreak(studiedDates, today),
    week: {
      totalMinutes: week[7]?.minutes ?? 0,
      completed: completedPlan,
      total: studyPlan.length,
      daysActive: studiedDates.size,
      goalMinutes: goal,
    },
    lastWeek: {
      totalMinutes: week[6]?.minutes ?? 0,
      completed: 0,
      total: 0,
    },
    subjectTrends,
    upcomingExams: data.exams
      .filter((e) => e.daysLeft >= 0)
      .sort((a, b) => a.daysLeft - b.daysLeft)
      .map((e) => ({ name: e.examName, daysLeft: e.daysLeft, readiness: e.readiness })),
    missedPast7: missed7 ?? 0,
    avgSessionMinutes,
    productiveRange: productiveRange
      ? { startHour: productiveRange.startHour, label: productiveRange.label, minutes: productiveRange.minutes }
      : null,
    planTodayTotal: data.today?.plannedMinutes ?? 0,
    planTodayCompleted: data.today?.completedMinutes ?? 0,
  });

  void subjectById;
  void exams;
  void units;
  void topics;
  void isNotNull;

  return {
    totalMinutes,
    weeklyAverageMinutes,
    completionRate,
    avgSessionMinutes,
    currentStreak: currentStreak(studiedDates, today),
    longestStreak: longestStreak(studiedDates),
    missed7: missed7 ?? 0,
    week,
    subjectShare,
    heatmap,
    dailyGoalMinutes: goal,
    insights,
    sessionCount: sessionCount ?? 0,
    totalTasks: totalTasks ?? 0,
    completedTasks: completedTasks ?? 0,
  };
}

function todayDayIndex(): number {
  const d = new Date();
  const dow = d.getDay();
  return dow === 0 ? 7 : dow;
}