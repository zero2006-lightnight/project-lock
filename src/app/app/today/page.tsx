import Link from "next/link";
import { ArrowLeft, ArrowRight, CalendarClock, CheckCircle2, Sparkles, Timer } from "lucide-react";
import { requireUser } from "@/lib/auth/actions";
import { getAppData } from "@/lib/services/data";
import { dayLabel, relativeDay, todayISO } from "@/lib/dates";
import { formatMinutes } from "@/lib/utils";
import { Card, CardBody } from "@/components/ui/card";
import { variantClasses, sizeClasses } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PlanItemRow } from "@/components/app/plan-item-row";
import { PlanActions, RescheduleButton } from "@/components/app/plan-actions";
import { minutesToClock } from "@/lib/dates";
import { ReadPlanButton } from "@/components/app/read-plan-button";

export const dynamic = "force-dynamic";

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const user = await requireUser();
  const data = await getAppData(user.id);
  const sp = await searchParams;

  // day navigation (fall back to today's real date when no plan exists yet)
  const planDates = data.plan.map((d) => d.date);
  const current = (sp.date && planDates.includes(sp.date) ? sp.date : data.today?.date ?? planDates[0]) ?? todayISO();
  const idx = planDates.indexOf(current);
  const prev = idx > 0 ? planDates[idx - 1] : null;
  const next = idx >= 0 && idx < planDates.length - 1 ? planDates[idx + 1] : null;

  const day = data.plan.find((d) => d.date === current) ?? {
    date: current,
    items: [],
    plannedMinutes: 0,
    completedMinutes: 0,
  };
  const items = day.items;
  const studyItems = items.filter((i) => i.kind !== "break");
  const pending = studyItems.filter((i) => i.status === "pending");
  const completed = studyItems.filter((i) => i.status === "completed");
  const missed = studyItems.filter((i) => i.status === "missed");
  const skipped = studyItems.filter((i) => i.status === "skipped");
  const isToday = current === data.today?.date;
  const doneMin = day.completedMinutes;
  const pct = day.plannedMinutes > 0 ? Math.round((doneMin / day.plannedMinutes) * 100) : 0;

  // any missed in the last week? (reschedule banner)
  const missedRecent = data.plan
    .filter((d) => d.items.some((i) => i.status === "missed"))
    .flatMap((d) => d.items.filter((i) => i.status === "missed"));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{relativeDay(day.date)}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {dayLabel(day.date)} · {studyItems.length} block{studyItems.length === 1 ? "" : "s"} ·{" "}
            {formatMinutes(day.plannedMinutes)} planned
          </p>
        </div>
        <div className="flex items-center gap-2">
          {prev && (
            <Link
              href={`/app/today?date=${prev}`}
              aria-label="Previous day"
              className={cn(variantClasses.outline, sizeClasses.icon, "inline-flex items-center justify-center")}
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
          )}
          {next && (
            <Link
              href={`/app/today?date=${next}`}
              aria-label="Next day"
              className={cn(variantClasses.outline, sizeClasses.icon, "inline-flex items-center justify-center")}
            >
              <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </div>
      </div>

      {/* progress summary */}
      <Card>
        <CardBody className="flex flex-wrap items-center gap-4 py-4">
          <div className="flex-1">
            <div className="mb-1.5 flex items-center justify-between text-sm">
              <span className="font-semibold">
                {completed.length}/{studyItems.length} blocks complete
              </span>
              <span className="text-muted-foreground">
                {formatMinutes(doneMin)} / {formatMinutes(day.plannedMinutes)}
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted shadow-inset-sm">
              <div
                className="bar-grow h-full rounded-full bg-primary transition-all duration-700"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isToday && <ReadPlanButton items={studyItems.map((item) => ({
              subject: item.subjectName,
              title: item.topicName ?? item.title,
              start: minutesToClock(item.startMinutes),
              end: minutesToClock(item.startMinutes + item.durationMinutes),
            }))} />}
            {isToday && pending.length > 0 && (
              <Link
                href="/app/focus"
                className={cn(variantClasses.primary, sizeClasses.sm, "inline-flex items-center gap-2")}
              >
                <Timer className="h-4 w-4" /> Start focus
              </Link>
            )}
            <PlanActions
              missedCount={missedRecent.length}
              hasPlan={data.plan.some((d) => d.items.length > 0)}
              todayDone={studyItems.length > 0 && pending.length === 0}
            />
          </div>
        </CardBody>
      </Card>

      {/* reschedule banner */}
      {missedRecent.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-warning/25 bg-warning-soft/70 px-5 py-4 shadow-inset-sm">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-warning/15 text-warning">
            <CalendarClock className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">
              You missed {missedRecent.length} block{missedRecent.length === 1 ? "" : "s"} — the plan adapts, it doesn&apos;t punish.
            </p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Rescheduling splits the topics across your next free slots without exceeding your available hours.
            </p>
          </div>
          <RescheduleButton count={missedRecent.length} />
        </div>
      )}

      {/* timeline */}
      <div className="space-y-2.5">
        {studyItems.length === 0 && (
          <Card>
            <CardBody className="flex flex-col items-center py-12 text-center">
              <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
                <CheckCircle2 className="h-6 w-6" />
              </span>
              <p className="text-base font-semibold">Nothing scheduled {isToday ? "today" : "this day"}</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                {isToday
                  ? "Your day is clear. Start a focus session on a flagged topic, or regenerate the week."
                  : "This day has no planned blocks."}
              </p>
              {isToday && (
                <Link href="/app/focus" className={cn(variantClasses.primary, sizeClasses.sm, "mt-5 inline-flex items-center gap-2")}>
                  <Sparkles className="h-4 w-4" /> Start a focus session
                </Link>
              )}
            </CardBody>
          </Card>
        )}

        {completed.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 text-success" /> Completed
            </p>
            <div className="space-y-2">
              {completed.map((item) => (
                <PlanItemRow key={item.id} item={item} actions={false} />
              ))}
            </div>
          </div>
        )}

        {pending.length > 0 && (
          <div>
            {completed.length > 0 && (
              <p className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Up next</p>
            )}
            <div className="space-y-2">
              {pending.map((item, i) => (
                <PlanItemRow key={item.id} item={item} highlightNext={i === 0 && isToday} />
              ))}
            </div>
          </div>
        )}

        {(missed.length > 0 || skipped.length > 0) && (
          <div>
            <p className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {isToday ? "Earlier today" : "Skipped / missed"}
            </p>
            <div className="space-y-2 opacity-80">
              {[...missed, ...skipped].map((item) => (
                <PlanItemRow key={item.id} item={item} actions={false} />
              ))}
            </div>
          </div>
        )}

        {items.some((i) => i.kind === "break") && (
          <p className="pt-2 text-center text-xs text-muted-foreground">
            Break{items.filter((i) => i.kind === "break").length > 1 ? "s" : ""} scheduled at{" "}
            {items
              .filter((i) => i.kind === "break")
              .slice(0, 3)
              .map((b) => minutesToClock(b.startMinutes))
              .join(", ")}
          </p>
        )}
      </div>
    </div>
  );
}

