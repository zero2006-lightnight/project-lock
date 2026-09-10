"use client";

import * as React from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { QUOTES, pickQuote, type DayQuote } from "@/lib/quotes";
import { staggerChild } from "@/components/motion/variants";

/* ──────────────────────────────────────────────────────────────
   Quote of the Day — calm dashboard moment, enhancement-only.

   - Static curated pool: no AI, no API, no DB, no blocking.
   - Selection runs ONCE per mount (useState initializer): stable
     across re-renders; sessionStorage keeps refreshes flicker-free;
     a fresh quote is picked when the session entry is stale.
   - Storage failures fall back silently — never breaks dashboard.
   ────────────────────────────────────────────────────────────── */

const HISTORY_KEY = "qotd.recent";
const SESSION_KEY = "qotd.session";
const SESSION_TTL_MS = 30 * 60 * 1000;

function readHistory(): string[] {
  try {
    const v = localStorage.getItem(HISTORY_KEY);
    if (!v) return [];
    const parsed = JSON.parse(v) as unknown;
    return Array.isArray(parsed) ? (parsed.filter((x) => typeof x === "string") as string[]) : [];
  } catch {
    return [];
  }
}

function readSession(): { id: string; at: number } | null {
  try {
    const v = sessionStorage.getItem(SESSION_KEY);
    if (!v) return null;
    const p = JSON.parse(v) as { id?: unknown; at?: unknown };
    if (typeof p.id === "string" && typeof p.at === "number") return { id: p.id, at: p.at };
    return null;
  } catch {
    return null;
  }
}

function selectOnce(): DayQuote {
  const fallback = QUOTES[0]!;
  try {
    const session = readSession();
    if (session && Date.now() - session.at < SESSION_TTL_MS) {
      const same = QUOTES.find((q) => q.id === session.id);
      if (same) return same;
    }
    const chosen = pickQuote(readHistory());
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id: chosen.id, at: Date.now() }));
      const next = [...readHistory().filter((id) => id !== chosen.id), chosen.id].slice(-8);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    } catch {
      /* persistence is best-effort */
    }
    return chosen;
  } catch {
    return fallback;
  }
}

/** Minimal botanical sprig — decorative only (aria-hidden). */
function LeafSprig({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 96 96" fill="none" aria-hidden="true" focusable="false" className={className}>
      <path d="M48 88 C48 60 48 34 52 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M50 26 C34 24 24 14 22 2 C38 4 48 12 50 26 Z" fill="currentColor" opacity="0.85" />
      <path d="M50 44 C66 42 76 32 78 20 C62 22 52 30 50 44 Z" fill="currentColor" opacity="0.65" />
      <path d="M49 62 C35 60 27 52 25 42 C39 44 47 50 49 62 Z" fill="currentColor" opacity="0.5" />
      <path d="M49 78 C61 76 69 70 71 60 C59 62 51 68 49 78 Z" fill="currentColor" opacity="0.35" />
    </svg>
  );
}

export function QuoteOfTheDay() {
  // Client-only selection: SSR and the first client render output the
  // same stable placeholder (no hydration mismatch), then one effect
  // picks the session quote. Re-renders never re-pick.
  const [quote, setQuote] = React.useState<DayQuote | null>(null);
  React.useEffect(() => {
    setQuote(selectOnce());
  }, []);

  if (!quote) {
    return (
      <section aria-label="Quote of the day" className="brutal-card min-h-32 px-5 py-5 sm:px-7 sm:py-6" aria-busy="true" />
    );
  }

  return (
    <motion.section
      key={quote.id}
      variants={staggerChild}
      initial="hidden"
      animate="show"
      aria-label="Quote of the day"
      className="brutal-card relative overflow-hidden px-5 py-5 sm:px-7 sm:py-6"
    >
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 flex items-center text-success",
          quote.variant === "leaf-left" ? "left-3 sm:left-5" : quote.variant === "leaf-right" ? "right-3 sm:right-5" : "bottom-1 right-4",
        )}
      >
        <LeafSprig
          className={cn(
            "h-20 w-20 opacity-60 sm:h-24 sm:w-24",
            quote.variant === "leaf-left" && "-scale-x-100",
            quote.variant === "sprig-bottom" && "h-14 w-14 opacity-50 sm:h-16 sm:w-16",
          )}
        />
      </div>
      <div
        className={cn(
          "relative",
          quote.variant === "leaf-left" ? "pl-20 sm:pl-24" : quote.variant === "leaf-right" ? "pr-20 sm:pr-24" : "pb-8 text-center",
          quote.variant === "sprig-bottom" && "mx-auto max-w-xl",
        )}
      >
        <p className="eyebrow text-muted-foreground">Quote of the day</p>
        <blockquote className="mt-2 font-brutal-display text-lg leading-snug tracking-tight text-foreground sm:text-xl">
          “{quote.text}”
        </blockquote>
        <p className="mt-2 text-xs text-muted-foreground">Take one focused step today.</p>
      </div>
    </motion.section>
  );
}
