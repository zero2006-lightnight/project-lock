import Link from "next/link";
import {
  BookOpen,
  CalendarClock,
  CheckCircle2,
  Flame,
  GraduationCap,
  ListTodo,
  Play,
  Sparkles,
  Target,
  TrendingUp,
  Zap,
} from "lucide-react";
import { requireUser } from "@/lib/auth/actions";
import { getAppData } from "@/lib/services/data";
import { getAnalytics } from "@/lib/services/analytics";
import { formatMinutes } from "@/lib/utils";
import { relativeDay } from "@/lib/dates";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Ring, Progress } from "@/components/ui/progress";
import { variantClasses, sizeClasses } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/skeleton";
import { PlanItemRow } from "@/components/app/plan-item-row";
import { WeeklyBarChart } from "@/components/app/charts";
import { QuoteOfTheDay } from "@/components/app/quote-of-the-day";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser();
  const [data, analytics] = await Promise.all([getAppData(user.id), getAnalytics(user.id)]);

  const hour = new Date().getHours();
  const greeting = hour < 5 ? "Working late" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = user.name.split(" ")[0];

  const todayItems = (data.today?.items ?? []).filter((i) => i.kind !== "break");
  const pendingToday = todayItems.filter((i) => i.status === "pending");
  const completedToday = todayItems.filter((i) => i.status === "completed");
  const missedToday = todayItems.filter((i) => i.status === "missed" || i.status === "skipped");
  const goal = data.user.dailyGoalMinutes;
  const doneMin = data.today?.completedMinutes ?? 0;
  const pct = goal > 0 ? Math.round((doneMin / goal) * 100) : 0;

  const nextUp = pendingToday[0];
  const upcomingTasks = data.tasks
    .filter((t) => t.deadline && t.status !== "completed" && t.status !== "skipped")
    .sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999))
    .slice(0, 4);
  const upcomingExams = data.exams
    .filter((e) => e.daysLeft >= 0)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 3);
  const weakTopics = data.subjects.flatMap((s) => s.weakTopics.map((w) => ({ subject: s.name, ...w }))).slice(0, 5);
  const insight = analytics.insights[0];

  return (
    <div className="rise-3d space-y-6">
      {/* Header — plain ink greeting, no emoji */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">
            {greeting}, {firstName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Here is what today needs from you.</p>
        </div>
        <div className="flex items-center gap-2.5">
          <Badge tone={data.streak > 0 ? "warning" : "neutral"} className="gap-2 px-3 py-1.5">
            <Flame className="h-3.5 w-3.5" /> {data.streak}-day streak
          </Badge>
          <Badge tone="primary" className="gap-2 px-3 py-1.5">
            <TrendingUp className="h-3.5 w-3.5" /> {formatMinutes(analytics.week.at(-1)?.minutes ?? 0)} this week
          </Badge>
          <Link
            href={nextUp ? `/app/focus?planItemId=${nextUp.id}` : "/app/today"}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-raise-sm transition-transform hover:-translate-y-0.5"
          >
            <Play className="h-4 w-4" />
            {nextUp ? "Start next session" : "Open today's plan"}
          </Link>
        </div>
      </div>

      {/* Quote of the day — calm moment above the plan; self-contained */}
      <QuoteOfTheDay />

      {/* Hero row — margin dial plus timetable ledger */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Progress ring — extruded dial */}
        <Card className="neo-extrude bevel-top relative overflow-hidden">
          <CardBody className="relative flex flex-col items-center justify-center py-7">
            <Ring value={pct} size={150} stroke={12} label={`${pct}%`} sublabel="of daily goal" />
            <p className="mt-4 font-display text-lg font-bold tracking-tight">
              {formatMinutes(doneMin)}
              <span className="font-sans text-sm font-medium text-muted-foreground"> of {formatMinutes(goal)}</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {todayItems.length === 0
                ? "No blocks scheduled today"
                : completedToday.length === todayItems.length
                  ? "All planned blocks complete. Well held."
                  : `${todayItems.length - completedToday.length} block${todayItems.length - completedToday.length === 1 ? "" : "s"} to go`}
            </p>
          </CardBody>
        </Card>

        {/* Today's plan */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Today&apos;s plan</CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">{data.today ? relativeDay(data.today.date) : "Today"}</p>
            </div>
            <Link
              href="/app/today"
              className={cn(variantClasses.ghost, sizeClasses.sm, "inline-flex items-center gap-1.5 underline-offset-4 hover:underline")}
            >
              Full plan
            </Link>
          </CardHeader>
          <CardBody className="space-y-2">
            {pendingToday.length === 0 && completedToday.length === 0 ? (
              <EmptyState
                compact
                icon={<Target className="h-6 w-6" />}
                title="Your day is clear"
                description="No study blocks are scheduled. Start a focus session on a flagged topic or generate a fresh plan."
                action={
                  <Link
                    href="/app/today"
                    className={cn(variantClasses.primary, sizeClasses.sm, "inline-flex items-center")}
                  >
                    Open today&apos;s plan
                  </Link>
                }
              />
            ) : (
              <>
                {pendingToday.slice(0, 4).map((item) => (
                  <PlanItemRow key={item.id} item={item} highlightNext={item.id === nextUp?.id} />
                ))}
                {completedToday.length > 0 && (
                  <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                    {completedToday.length} block{completedToday.length === 1 ? "" : "s"} completed{missedToday.length > 0 && `, ${missedToday.length} missed`}
                  </div>
                )}
              </>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Middle row */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {/* AI insight */}
        <Card className="xl:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <Sparkles className="h-4 w-4" />
              </span>
              <CardTitle>Pilot&apos;s take</CardTitle>
            </div>
          </CardHeader>
          <CardBody>
            {insight ? (
              <div>
                <p className="text-sm font-semibold">{insight.title}</p>
                <p className="mt-1.5 max-w-prose text-[13px] leading-relaxed text-muted-foreground">{insight.message}</p>
                <Link href="/app/chat" className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-primary hover:underline">
                  Ask Pilot for details
                </Link>
              </div>
            ) : (
              <p className="text-[13px] text-muted-foreground">
                Start studying to unlock personalized insights about your rhythm and weak spots.
              </p>
            )}
          </CardBody>
        </Card>

        {/* Upcoming deadlines */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ListTodo className="h-4 w-4 text-muted-foreground" /> Deadlines
            </CardTitle>
          </CardHeader>
          <CardBody className="pt-1">
            {upcomingTasks.length === 0 ? (
              <p className="py-4 text-center text-[13px] text-muted-foreground">Nothing due. Enjoy the calm.</p>
            ) : (
              <div className="space-y-2">
                {upcomingTasks.map((t) => (
                  <div key={t.id} className="neo-inset-sm flex items-center gap-2.5 rounded-xl bg-muted/40 px-3 py-2">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: t.subjectColor ?? "var(--color-muted-foreground)" }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{t.title}</p>
                      <p className="text-[11px] text-muted-foreground">{t.subjectName ?? "General"}</p>
                    </div>
                    <Badge tone={(t.daysLeft ?? 99) <= 2 ? "danger" : (t.daysLeft ?? 99) <= 5 ? "warning" : "neutral"}>
                      {t.daysLeft === 0 ? "Today" : `${t.daysLeft}d`}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
            <Link href="/app/tasks" className="mt-2 inline-flex text-xs font-semibold text-primary hover:underline">
              All tasks
            </Link>
          </CardBody>
        </Card>

        {/* Exams countdown */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GraduationCap className="h-4 w-4 text-muted-foreground" /> Exams
            </CardTitle>
          </CardHeader>
          <CardBody className="pt-1">
            {upcomingExams.length === 0 ? (
              <p className="py-4 text-center text-[13px] text-muted-foreground">No exams added yet.</p>
            ) : (
              <div className="space-y-2">
                {upcomingExams.map((e) => (
                  <div key={e.id} className="neo-inset-sm block rounded-xl bg-muted/40 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-[13px] font-medium">{e.examName}</p>
                      <Badge tone={e.daysLeft <= 7 ? "danger" : "warning"}>{e.daysLeft}d</Badge>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <Progress value={e.readiness} tone={e.readiness >= 80 ? "success" : e.readiness >= 50 ? "primary" : "warning"} className="flex-1" />
                      <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">{e.readiness}%</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <Link href="/app/exams" className="mt-2 inline-flex text-xs font-semibold text-primary hover:underline">
              Exam readiness
            </Link>
          </CardBody>
        </Card>
      </div>

      {/* Bottom row */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {/* Weekly chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-muted-foreground" /> Weekly focus
            </CardTitle>
          </CardHeader>
          <CardBody>
            <WeeklyBarChart data={analytics.week} height={170} />
            <p className="mt-2 text-xs text-muted-foreground">
              Average {formatMinutes(analytics.weeklyAverageMinutes)} per day, completion rate {analytics.completionRate}%
            </p>
          </CardBody>
        </Card>

        {/* Weak topics */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-warning" /> Needs attention
            </CardTitle>
          </CardHeader>
          <CardBody>
            {weakTopics.length === 0 ? (
              <p className="py-4 text-center text-[13px] text-muted-foreground">No topics flagged. You are in good shape.</p>
            ) : (
              <ul className="space-y-1.5">
                {weakTopics.map((w) => (
                  <li key={w.id} className="neo-inset-sm flex items-center gap-2.5 rounded-lg bg-muted/30 px-2 py-1.5 text-[13px]">
                    <BookOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="font-medium">{w.name}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{w.subject}</span>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/app/syllabus" className="mt-3 inline-flex text-xs font-semibold text-primary hover:underline">
              Open syllabus
            </Link>
          </CardBody>
        </Card>

        {/* Subject progress */}
        <Card className="md:col-span-2 xl:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-muted-foreground" /> Subjects
            </CardTitle>
          </CardHeader>
          <CardBody className="space-y-3.5">
            {data.subjects.length === 0 ? (
              <EmptyState
                compact
                icon={<BookOpen className="h-6 w-6" />}
                title="No subjects yet"
                description="Add your subjects and StudyPilot will build your roadmap."
                action={
                  <Link
                    href="/app/syllabus"
                    className={cn(variantClasses.primary, sizeClasses.sm, "inline-flex items-center")}
                  >
                    Add subjects
                  </Link>
                }
              />
            ) : (
              data.subjects.slice(0, 5).map((s) => (
                <div key={s.id}>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="flex items-center gap-2 text-[13px] font-medium">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                      {s.name}
                    </p>
                    <span className="text-xs font-semibold tabular-nums text-muted-foreground">{s.progress}%</span>
                  </div>
                  <Progress value={s.progress} tone={s.progress >= 80 ? "success" : "primary"} />
                  {s.exam && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      <CalendarClock className="mr-1 inline h-3 w-3" />
                      {s.exam.name} in {s.exam.daysLeft}d
                    </p>
                  )}
                </div>
              ))
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}