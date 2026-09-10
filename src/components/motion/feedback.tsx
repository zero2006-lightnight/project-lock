"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { errorNudge, recallReveal, successPop } from "./variants";

/* ──────────────────────────────────────────────────────────────
   Shared feedback primitives — one place for loading stages,
   success confirmation, and calm error display.
   Stages must always reflect real processing state; callers
   advance `stageIndex` as real work progresses. Never fake.
   ────────────────────────────────────────────────────────────── */

export function LoadingStages({
  stages,
  stageIndex,
  busyLabel,
}: {
  stages: string[];
  stageIndex: number;
  busyLabel: string;
}) {
  const current = stages[Math.min(stageIndex, stages.length - 1)];
  return (
    <div className="flex items-center gap-3 rounded-[6px] border-2 border-ink bg-card px-4 py-3 shadow-brutal-sm" role="status" aria-live="polite">
      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
      <div className="min-w-0">
        <p className="text-[13px] font-semibold">{busyLabel}</p>
        <AnimatePresence mode="wait">
          <motion.p
            key={current}
            variants={recallReveal}
            initial="hidden"
            animate="show"
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            className="truncate text-xs text-muted-foreground"
          >
            {current}…
          </motion.p>
        </AnimatePresence>
        <div className="mt-1.5 flex gap-1" aria-hidden>
          {stages.map((s, i) => (
            <span
              key={s}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors duration-300",
                i <= stageIndex ? "bg-lime" : "bg-muted",
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function SuccessNote({ title, body }: { title: string; body?: string }) {
  return (
    <motion.div
      variants={successPop}
      initial="hidden"
      animate="show"
      className="flex items-start gap-2.5 rounded-[6px] border-2 border-ink bg-success-soft px-4 py-3 shadow-brutal-sm"
      role="status"
    >
      <CheckCircle2 className="mt-0.5 h-4.5 w-4.5 shrink-0 text-success" aria-hidden />
      <div>
        <p className="text-[13px] font-bold text-success">{title}</p>
        {body && <p className="mt-0.5 text-xs leading-relaxed text-foreground/80">{body}</p>}
      </div>
    </motion.div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <motion.div
      variants={errorNudge}
      initial="hidden"
      animate="show"
      className="flex items-start gap-2.5 rounded-[6px] border-2 border-ink bg-danger-soft px-4 py-3 shadow-brutal-sm"
      role="alert"
    >
      <AlertCircle className="mt-0.5 h-4.5 w-4.5 shrink-0 text-danger" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-bold text-danger">Something needs attention</p>
        <p className="mt-0.5 text-xs leading-relaxed text-foreground/80">{message}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-1.5 cursor-pointer text-xs font-bold text-danger underline underline-offset-2 hover:opacity-80"
          >
            Try again
          </button>
        )}
      </div>
    </motion.div>
  );
}

/** Quiz / generation stage cycler: advances through real labels on a
 *  timer while `active`, resets when idle. Labels describe phases of
 *  the same in-flight request — not fabricated progress. */
export function useStagedBusy(active: boolean, stages: string[], stepMs = 2200) {
  const [stageIndex, setStageIndex] = React.useState(0);
  React.useEffect(() => {
    if (!active) {
      setStageIndex(0);
      return;
    }
    setStageIndex(0);
    const t = window.setInterval(() => {
      setStageIndex((i) => (i + 1 < stages.length ? i + 1 : i));
    }, stepMs);
    return () => window.clearInterval(t);
  }, [active, stages, stepMs]);
  return stageIndex;
}
