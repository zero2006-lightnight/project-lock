/* ──────────────────────────────────────────────────────────────
   §7 — User intent analysis: what does the user actually need?

   "Explain recursion" can mean a one-line refresher, an exam answer,
   or a deep dive. Cues in the question win; otherwise the profile's
   weak areas + detail preference disambiguate. Never produce maximum
   detail for every question by default.
   ────────────────────────────────────────────────────────────── */

import type { QueryLabel, UserIntent } from "./types";
import { primaryLabel } from "./classify";

const T = (re: RegExp, q: string) => re.test(q);

export type IntentSignals = {
  labels: QueryLabel[];
  weakTopics: string[]; // lowercased topic names the user struggles with
  detailPref: "short" | "medium" | "detailed";
  questionKeywords: string[];
};

export function detectIntent(raw: string, signals: IntentSignals): UserIntent {
  const q = raw.toLowerCase();
  const primary = primaryLabel(signals.labels);

  // Explicit cues win over everything.
  if (T(/\b(brief(ly)?|short|quick(ly)?|one ?line|in a sentence|just the gist)\b/, q)) return "quick_fact";
  if (T(/\b(exam|marks?|score|important (for|from).*(exam|test)|likely (asked|question)|previous year|pyq)\b/, q))
    return "exam_prep";
  if (T(/\b(detail|in[- ]depth|thorough|elaborate|from scratch|first principles|internals?|call stack|derivation)\b/, q))
    return "learn";
  if (primary === "revision" || primary === "summary") return "revise";
  if (primary === "problem_solving" || primary === "step_by_step") return "apply";

  // Implicit: question touches a known weak area → teach, don't just tell.
  const touchesWeak = signals.questionKeywords.some((k) =>
    signals.weakTopics.some((w) => w.includes(k.slice(0, 6)) || k.includes(w.slice(0, 8))),
  );
  if (touchesWeak && signals.detailPref !== "short") return "learn";

  // Implicit: bare definition + short preference → quick fact.
  if (primary === "definition" && signals.detailPref === "short") return "quick_fact";

  // Default: honest middle — a real explanation, not maximum detail.
  return signals.detailPref === "short" ? "quick_fact" : "learn";
}
