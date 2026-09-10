import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info" | "accent";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  primary: "bg-primary-soft text-primary",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  accent: "bg-accent-soft text-accent",
};

const dotClasses: Record<Tone, string> = {
  neutral: "bg-muted-foreground",
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  accent: "bg-accent",
};

export function Badge({
  tone = "neutral",
  dot = false,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone; dot?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border-2 border-ink px-2.5 py-1 font-brutal-mono text-[11px] font-bold uppercase leading-none tracking-wide shadow-brutal-sm",
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", dotClasses[tone])} aria-hidden />}
      {children}
    </span>
  );
}

export function StatusPill({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const map: Record<string, { tone: Tone; label: string }> = {
    completed: { tone: "success", label: "Completed" },
    pending: { tone: "neutral", label: "Upcoming" },
    in_progress: { tone: "primary", label: "In progress" },
    todo: { tone: "neutral", label: "To do" },
    skipped: { tone: "warning", label: "Skipped" },
    missed: { tone: "danger", label: "Missed" },
    not_started: { tone: "neutral", label: "Not started" },
    learning: { tone: "info", label: "Learning" },
    needs_revision: { tone: "warning", label: "Needs revision" },
  };
  const m = map[status] ?? { tone: "neutral" as Tone, label: status.replace(/_/g, " ") };
  return (
    <Badge tone={m.tone} dot className={className}>
      {m.label}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: number }) {
  const map = {
    1: { tone: "neutral" as Tone, label: "Low" },
    2: { tone: "info" as Tone, label: "Medium" },
    3: { tone: "danger" as Tone, label: "High" },
  };
  const m = map[priority as keyof typeof map] ?? map[2];
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export function DifficultyDots({ level, max = 5 }: { level: number; max?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`Difficulty ${level} of ${max}`}>
      {Array.from({ length: max }).map((_, i) => (
        <span
          key={i}
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            i < Math.max(1, level) ? "bg-primary/70" : "bg-border",
          )}
        />
      ))}
    </span>
  );
}

export { toneClasses };
export type { Tone };
