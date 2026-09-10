export type GeneratedInsight = {
  id: string;
  title: string;
  message: string;
  tone: "positive" | "warning" | "info";
  kind: "productivity" | "consistency" | "subject" | "exam" | "tasks" | "milestone";
};

export type InsightsContext = {
  userName: string;
  streak: number;
  /** this calendar week (Mon..today) */
  week: { totalMinutes: number; completed: number; total: number; daysActive: number; goalMinutes: number };
  lastWeek: { totalMinutes: number; completed: number; total: number } | null;
  subjectTrends: {
    subjectId: string;
    name: string;
    color: string;
    thisWeekMinutes: number;
    lastWeekMinutes: number;
    examDaysLeft: number | null;
    syllabusPercent: number;
  }[];
  upcomingExams: { name: string; daysLeft: number; readiness: number }[];
  missedPast7: number;
  avgSessionMinutes: number;
  productiveRange: { startHour: number; label: string; minutes: number } | null;
  planTodayTotal: number;
  planTodayCompleted: number;
};

const MIN_WEEK_MINUTES = 30;

export function generateInsights(ctx: InsightsContext): GeneratedInsight[] {
  const out: GeneratedInsight[] = [];
  const h = ctx.userName.split(" ")[0] || "there";
  const minutes = (m: number) => {
    const hh = Math.floor(m / 60);
    const mm = Math.round(m % 60);
    return hh > 0 ? `${hh}h ${mm.toString().padStart(2, "0")}m` : `${mm}m`;
  };

  // ── Exam urgency ────────────────────────────────────────────
  const imminent = ctx.upcomingExams
    .filter((e) => e.daysLeft <= 21 && e.daysLeft >= 0)
    .sort((a, b) => a.daysLeft - b.daysLeft)[0];
  if (imminent && imminent.readiness < 80) {
    out.push({
      id: "exam-readiness",
      title: `${imminent.name} needs attention`,
      message:
        imminent.readiness < 60
          ? `Your ${imminent.name} is in ${imminent.daysLeft} day${imminent.daysLeft === 1 ? "" : "s"} and readiness is at ${imminent.readiness}%. I've front-loaded its remaining topics so you close the gap in time.`
          : `Your ${imminent.name} is in ${imminent.daysLeft} day${imminent.daysLeft === 1 ? "" : "s"} at ${imminent.readiness}% readiness — keep the momentum and the flagged topics will be covered before exam day.`,
      tone: imminent.readiness < 60 ? "warning" : "info",
      kind: "exam",
    });
  }

  // ── Missed work ─────────────────────────────────────────────
  if (ctx.missedPast7 > 0) {
    out.push({
      id: "missed",
      title: "Life happens — plan adapted",
      message: `You missed ${ctx.missedPast7} planned block${ctx.missedPast7 === 1 ? "" : "s"} recently. I've redistributed the topics across the coming days instead of dropping them, without exceeding your available hours.`,
      tone: "info",
      kind: "tasks",
    });
  }

  // ── Subject needing attention ───────────────────────────────
  const behind = ctx.subjectTrends
    .filter((s) => s.syllabusPercent < 70)
    .sort((a, b) => a.syllabusPercent - b.syllabusPercent)[0];
  const examSoonSubject = ctx.subjectTrends
    .filter((s) => s.examDaysLeft !== null && s.examDaysLeft <= 21)
    .sort((a, b) => (a.examDaysLeft ?? 999) - (b.examDaysLeft ?? 999))[0];
  if (examSoonSubject && behind && behind.subjectId !== examSoonSubject.subjectId && behind.thisWeekMinutes < 45) {
    out.push({
      id: "weakest-subject",
      title: `${behind.name} needs more time`,
      message: `You're at ${behind.syllabusPercent}% of the ${behind.name} syllabus. Adding a short daily session will keep it from becoming a last-minute problem.`,
      tone: "warning",
      kind: "subject",
    });
  }

  // ── Week-over-week improvement ──────────────────────────────
  if (ctx.lastWeek && ctx.lastWeek.totalMinutes >= MIN_WEEK_MINUTES) {
    const growth = ctx.week.totalMinutes - ctx.lastWeek.totalMinutes;
    if (growth >= 30) {
      out.push({
        id: "wow",
        title: "Momentum building",
        message: `You've studied ${minutes(growth)} more this week than last week${growth >= 90 ? " — that's a serious jump. Keep it sustainable." : ". Nice and steady."}`,
        tone: "positive",
        kind: "milestone",
      });
    }
  }

  // ── Subject level shift ─────────────────────────────────────
  const improved = ctx.subjectTrends.find(
    (s) => s.lastWeekMinutes >= 20 && s.thisWeekMinutes > s.lastWeekMinutes * 1.25,
  );
  if (improved) {
    out.push({
      id: "subject-gain",
      title: `${improved.name} is trending up`,
      message: `Your focus on ${improved.name} is up ${Math.round(((improved.thisWeekMinutes - improved.lastWeekMinutes) / Math.max(1, improved.lastWeekMinutes)) * 100)}% week over week.`,
      tone: "positive",
      kind: "subject",
    });
  }

  // ── Productivity window ─────────────────────────────────────
  if (ctx.productiveRange && ctx.week.totalMinutes >= 60) {
    out.push({
      id: "peak-time",
      title: "Your peak hours",
      message: `You're most productive between ${ctx.productiveRange.label}. Scheduling your hardest topics there tends to give the best return on time.`,
      tone: "info",
      kind: "productivity",
    });
  }

  // ── Streak ──────────────────────────────────────────────────
  if (ctx.streak >= 3) {
    out.push({
      id: "streak",
      title: ctx.streak >= 7 ? `${ctx.streak}-day streak 🔥` : `${ctx.streak}-day streak`,
      message:
        ctx.streak >= 7
          ? `A full week of consistency, ${h}. This is how exam-ready students are made.`
          : `You've studied ${ctx.streak} days in a row. One more day keeps the streak alive.`,
      tone: "positive",
      kind: "consistency",
    });
  }

  // ── Average session quality ─────────────────────────────────
  if (ctx.avgSessionMinutes >= 25 && ctx.week.daysActive >= 3) {
    out.push({
      id: "sessions",
      title: "Deep sessions",
      message: `Your average session is ${minutes(ctx.avgSessionMinutes)} — long enough for real focus. Try protecting that time from interruptions.`,
      tone: "positive",
      kind: "productivity",
    });
  }

  // ── Today status ────────────────────────────────────────────
  if (ctx.planTodayTotal > 0 && ctx.planTodayCompleted === ctx.planTodayTotal) {
    out.push({
      id: "today-done",
      title: "Today's plan complete 🎉",
      message: `You finished every planned block for today. ${ctx.upcomingExams.length ? `Tomorrow I'll keep the pressure on ${ctx.upcomingExams[0].name}.` : "Tomorrow's plan is already waiting for you."}`,
      tone: "positive",
      kind: "milestone",
    });
  }

  return out.slice(0, 4);
}
