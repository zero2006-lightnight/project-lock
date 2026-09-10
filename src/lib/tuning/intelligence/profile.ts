/* ──────────────────────────────────────────────────────────────
   §3/§4 + §17/§18 — Personal intelligence: learning profile +
   preference signals.

   RULES (hard):
   - Only learning/application activity. No personality judgments.
   - Evidence-based notes ("recent quizzes show X was difficult"),
     never labels ("you are lazy").
   - One interaction never locks a preference: temporary (1) →
     confidence (2–3) → suggested (4+). Suggested preferences stay
     viewable, editable, resettable.
   ────────────────────────────────────────────────────────────── */

import type {
  LearningProfile,
  PreferenceSignals,
  SignalStage,
  VisualDecisionKind,
} from "./types";
import { signalStage } from "./types";
import type { TuningPersonalization } from "../retrieve";

export type ProfileInput = {
  me: TuningPersonalization;
  signals: PreferenceSignals;
};

const VISUAL_KINDS: VisualDecisionKind[] = ["flowchart", "concept_map", "table", "graph", "image"];

/** Preferred visual ONLY when repeated evidence says so (suggested stage). */
export function preferredVisualFrom(signals: PreferenceSignals): VisualDecisionKind | null {
  let best: { kind: VisualDecisionKind; count: number } | null = null;
  for (const kind of VISUAL_KINDS) {
    const count = signals.visualRequests[kind] ?? 0;
    if (signalStage(count) === "suggested" && (!best || count > best.count)) {
      best = { kind, count };
    }
  }
  return best?.kind ?? null;
}

export function buildLearningProfile(input: ProfileInput): LearningProfile {
  const { me, signals } = input;
  return {
    activeSubjects: me.recentSubjects.slice(0, 5),
    strongConcepts: me.strongAreas.slice(0, 5),
    needsPractice: me.weakAreas.slice(0, 5),
    recentActivity: me.recentSubjects.slice(0, 3),
    preferredDetail: me.detailLevel,
    preferredVisual: preferredVisualFrom(signals),
    quizAccuracy: me.quizAccuracy,
    streakDays: me.streakDays,
  };
}

/**
 * Evidence-based personal note for an answer, or null when
 * personalization would add nothing (§13: don't over-personalize).
 * Only references the question's own topics — never drags in
 * unrelated weak areas.
 */
export function personalNoteFor(
  questionKeywords: string[],
  profile: LearningProfile,
): string | null {
  const weak = profile.needsPractice.filter((w) =>
    questionKeywords.some(
      (k) =>
        w.topic.toLowerCase().includes(k.slice(0, 6)) || k.includes(w.topic.toLowerCase().slice(0, 8)),
    ),
  );
  if (!weak.length) return null;
  const named = weak
    .slice(0, 2)
    .map((w) => `${w.topic} (${w.subject})`)
    .join(" and ");
  return (
    `Your recent practice shows ${named} ${weak.length === 1 ? "has" : "have"} been difficult, ` +
    `so this answer spends extra care there.`
  );
}

/* ── Preference signals (§17/§18) ── */

export function emptySignals(): PreferenceSignals {
  return { visualRequests: {}, detailRequests: {}, styleRequests: {}, updatedAt: new Date().toISOString() };
}

export function parseSignals(raw: string | null): PreferenceSignals {
  if (!raw) return emptySignals();
  try {
    const p = JSON.parse(raw) as Partial<PreferenceSignals>;
    return {
      visualRequests: p.visualRequests ?? {},
      detailRequests: p.detailRequests ?? {},
      styleRequests: p.styleRequests ?? {},
      updatedAt: typeof p.updatedAt === "string" ? p.updatedAt : new Date().toISOString(),
    };
  } catch {
    return emptySignals();
  }
}

export type ObservedInteraction = {
  visual: VisualDecisionKind;
  complexity: "short" | "medium" | "detailed";
  styles: string[]; // e.g. ["example"], ["exam"], ["steps"]
};

/** Record one interaction — increments only; stages derive from counts. */
export function recordInteraction(signals: PreferenceSignals, obs: ObservedInteraction): PreferenceSignals {
  const bump = (rec: Record<string, number>, key: string) => ({ ...rec, [key]: (rec[key] ?? 0) + 1 });
  let next: PreferenceSignals = {
    visualRequests: signals.visualRequests,
    detailRequests: signals.detailRequests,
    styleRequests: signals.styleRequests,
    updatedAt: new Date().toISOString(),
  };
  if (obs.visual !== "none") next = { ...next, visualRequests: bump(next.visualRequests, obs.visual) };
  next = { ...next, detailRequests: bump(next.detailRequests, obs.complexity) };
  for (const s of obs.styles) next = { ...next, styleRequests: bump(next.styleRequests, s) };
  return next;
}

/** Stage of a single tracked key (exposed for UI + tests). */
export function stageOf(signals: PreferenceSignals, bucket: keyof Omit<PreferenceSignals, "updatedAt">, key: string): SignalStage {
  return signalStage(signals[bucket][key] ?? 0);
}
