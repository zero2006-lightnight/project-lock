"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, ChevronRight, Clock, Play, SkipForward } from "lucide-react";
import { cn, formatMinutes } from "@/lib/utils";
import { minutesToClock } from "@/lib/dates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toaster";
import {
  completePlanItemAction,
  postponePlanItemAction,
  skipPlanItemAction,
} from "@/lib/actions/planning";
import type { PlanItemAgg } from "@/lib/services/types";

export function PlanItemRow({
  item,
  showTime = true,
  actions = true,
  highlightNext = false,
}: {
  item: PlanItemAgg;
  showTime?: boolean;
  actions?: boolean;
  highlightNext?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);

  if (item.kind === "break") {
    return (
      <div className="flex items-center gap-3 rounded-xl px-2 py-1.5 text-muted-foreground">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-dashed border-border bg-muted/40">
          <Clock className="h-3.5 w-3.5" />
        </div>
        <p className="text-[13px] italic">{item.title}</p>
        {showTime && <span className="ml-auto text-xs">{minutesToClock(item.startMinutes)}</span>}
      </div>
    );
  }

  const done = item.status === "completed";
  const missed = item.status === "missed";
  const skipped = item.status === "skipped";

  const run = async (fn: () => Promise<{ ok: boolean; error?: string; unlocked?: string[] }>) => {
    setBusy(true);
    const res = await fn();
    if (!res.ok) {
      toast("error", "Something went wrong", res.error);
    } else if (res.unlocked?.length) {
      toast("success", `Achievement unlocked: ${res.unlocked[0]}`);
    }
    router.refresh();
    setBusy(false);
  };

  const actionBtn = (() => {
    if (done) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2.5 py-1 text-xs font-semibold text-success shadow-inset-sm">
          <Check className="h-3.5 w-3.5" /> Done
        </span>
      );
    }
    if (missed) {
      return (
        <Badge tone="danger" dot>
          Missed
        </Badge>
      );
    }
    if (skipped) {
      return (
        <Badge tone="warning" dot>
          Skipped
        </Badge>
      );
    }
    return null;
  })();

  return (
    <div
      className={cn(
        "group relative flex items-center gap-3 rounded-2xl bg-card px-3.5 py-3 neo-raise-sm transition-all duration-200 hover:shadow-raise",
        done && "opacity-70",
        highlightNext && !done && !missed && "bg-primary-soft/60 ring-1 ring-inset ring-primary/25",
      )}
    >
      {/* left time rail */}
      {showTime && !missed && (
        <div className="w-12 shrink-0 text-center">
          <p className={cn("text-[13px] font-semibold tabular-nums", done ? "text-muted-foreground" : "text-foreground")}>
            {minutesToClock(item.startMinutes)}
          </p>
          <p className="text-[10px] text-muted-foreground">{formatMinutes(item.durationMinutes)}</p>
        </div>
      )}
      {missed && (
        <div className="w-12 shrink-0 text-center">
          <CalendarClock className="mx-auto h-4 w-4 text-danger" />
        </div>
      )}

      {/* subject color dot + content */}
      <span
        className="h-9 w-1.5 shrink-0 rounded-full"
        style={{ background: item.subjectColor ?? "var(--color-muted-foreground)" }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm font-semibold", done && "line-through decoration-muted-foreground/50")}>
          {item.topicName ?? item.title}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {item.subjectName && <span>{item.subjectName}</span>}
          {item.reason && (
            <span className="inline-flex items-center gap-1">
              <span className="text-border">·</span>
              {item.reason}
            </span>
          )}
        </p>
      </div>

      {actionBtn}

      {actions && !done && !missed && !skipped && (
        <div className="flex shrink-0 items-center gap-0.5 rounded-xl bg-muted/50 p-0.5 opacity-100 shadow-inset-sm transition-opacity lg:opacity-0 lg:group-hover:opacity-100">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Start focus session"
            title="Start focus session"
            loading={busy}
            onClick={() => router.push(`/app/focus?planItemId=${item.id}`)}
          >
            <Play className="h-4 w-4 text-success" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Mark complete"
            title="Mark complete"
            loading={busy}
            onClick={() => run(() => completePlanItemAction(item.id))}
          >
            <Check className="h-4 w-4" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Move to tomorrow"
            title="Move to tomorrow"
            loading={busy}
            onClick={() => run(() => postponePlanItemAction(item.id, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Skip"
            title="Skip"
            loading={busy}
            onClick={() => run(() => skipPlanItemAction(item.id))}
          >
            <SkipForward className="h-4 w-4" />
          </Button>
        </div>
      )}

      {!done && !missed && !skipped && (
        <Link
          href={`/app/focus?planItemId=${item.id}`}
          className="absolute inset-0 rounded-2xl lg:hidden"
          aria-label={`Start focus on ${item.topicName ?? item.title}`}
        />
      )}
    </div>
  );
}

export function PlanItemMini({ item }: { item: PlanItemAgg }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-card px-3 py-2.5 neo-raise-sm">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: item.subjectColor ?? "var(--color-muted-foreground)" }} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold">{item.topicName ?? item.title}</p>
        <p className="text-[11px] text-muted-foreground">{item.subjectName ?? "General"}</p>
      </div>
      <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
        {minutesToClock(item.startMinutes)}
      </span>
    </div>
  );
}
