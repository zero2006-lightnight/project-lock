import Link from "next/link";
import {
  Activity,
  BarChart3,
  CheckCircle2,
  Clock,
  Flame,
  Lightbulb,
  ListChecks,
  Sparkles,
  Timer,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import { requireUser } from "@/lib/auth/actions";
import { getAnalytics } from "@/lib/services/analytics";
import { formatMinutes } from "@/lib/utils";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/skeleton";
import { WeeklyBarChart, SubjectDonut, HeatmapGrid } from "@/components/app/charts";

export const dynamic = "force-dynamic";

const toneIcon = {
  positive: CheckCircle2,
  warning: TriangleAlert,
  info: Lightbulb,
} as const;

export default async function ProgressPage() {
  const user = await requireUser();
  const a = await getAnalytics(user.id);

  const stats = [
    { label: "Total study time", value: formatMinutes(a.totalMinutes), icon: Clock, hint: `${a.sessionCount} completed sessions` },
    { label: "Avg / day this week", value: formatMinutes(a.weeklyAverageMinutes), icon: TrendingUp, hint: `Goal ${formatMinutes(a.dailyGoalMinutes)}` },
    { label: "Plan completion", value: `${a.completionRate}%`, icon: ListChecks, hint: "this week" },
    { label: "Avg session length", value: formatMinutes(a.avgSessionMinutes), icon: Timer, hint: "deep enough to count" },
    { label: "Streak", value: `${a.currentStreak}d`, icon: Flame, hint: `longest ${a.longestStreak}d` },
    { label: "Missed blocks", value: `${a.missed7}`, icon: Activity, hint: "last 7 days" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Progress & Analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">Am I improving? Every chart answers a question.</p>
      </div>

      {/* metric cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardBody className="py-4">
              <s.icon className="mb-2 h-4.5 w-4.5 text-muted-foreground" />
              <p className="text-lg font-bold tracking-tight leading-none">{s.value}</p>
              <p className="mt-1.5 text-[11px] font-medium text-muted-foreground">{s.label}</p>
              <p className="text-[10px] text-muted-foreground/70">{s.hint}</p>
            </CardBody>
          </Card>
        ))}
      </div>

      {/* insights */}
      {a.insights.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-accent" /> Pilot&apos;s insights
            </CardTitle>
          </CardHeader>
          <CardBody className="grid gap-3 md:grid-cols-2">
            {a.insights.map((ins) => {
              const Icon = toneIcon[ins.tone];
              return (
                <div
                  key={ins.id}
                  className="rounded-2xl bg-muted/40 p-4 shadow-inset-sm"
                >
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <Icon
                      className={
                        ins.tone === "positive"
                          ? "h-4 w-4 text-success"
                          : ins.tone === "warning"
                            ? "h-4 w-4 text-warning"
                            : "h-4 w-4 text-info"
                      }
                    />
                    {ins.title}
                  </p>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{ins.message}</p>
                </div>
              );
            })}
          </CardBody>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* weekly */}
        <Card>
          <CardHeader>
            <CardTitle>How much did I study each week?</CardTitle>
          </CardHeader>
          <CardBody>
            <WeeklyBarChart data={a.week} height={200} />
          </CardBody>
        </Card>

        {/* subject share */}
        <Card>
          <CardHeader>
            <CardTitle>Which subjects get my time?</CardTitle>
          </CardHeader>
          <CardBody>
            {a.subjectShare.length === 0 ? (
              <EmptyState compact icon={<BarChart3 className="h-6 w-6" />} title="No study time yet" description="Complete a focus session and your subject mix will appear here." />
            ) : (
              <>
                <SubjectDonut data={a.subjectShare} height={180} />
                <div className="mt-3 space-y-1.5">
                  {a.subjectShare.slice(0, 5).map((s) => (
                    <div key={s.name} className="flex items-center gap-2 text-xs">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                      <span className="font-medium">{s.name}</span>
                      <span className="ml-auto text-muted-foreground">{formatMinutes(s.minutes)}</span>
                      <span className="w-12 text-right font-semibold tabular-nums">
                        {Math.round((s.minutes / Math.max(1, a.totalMinutes)) * 100)}%
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardBody>
        </Card>
      </div>

      {/* heatmap */}
      <Card>
        <CardHeader>
          <CardTitle>Consistency — the last 12 weeks</CardTitle>
        </CardHeader>
        <CardBody>
          {a.totalMinutes === 0 ? (
            <EmptyState compact icon={<Flame className="h-6 w-6" />} title="No sessions yet" description="Your heatmap lights up with every completed study session." />
          ) : (
            <HeatmapGrid data={a.heatmap} />
          )}
        </CardBody>
      </Card>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge tone="primary">
          <Sparkles className="h-3 w-3" /> Insights are rule-based from your real data — no guesses
        </Badge>
        <Link href="/app/achievements" className="font-semibold text-primary hover:underline">
          View achievements →
        </Link>
      </div>
    </div>
  );
}