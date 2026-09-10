/* ──────────────────────────────────────────────────────────────
   §9/§10 — Visual decision engine.

   Never generate visuals randomly. A visual must earn its place:
   explicit request, or a process/relationship/data shape where text
   alone is weaker. Generation priority: structured diagram
   (Mermaid/SVG data) → chart/graph (real data only) → image.
   Graphs NEVER use fabricated values — without real data, no graph.
   ────────────────────────────────────────────────────────────── */

import type { QueryLabel, UserIntent, VisualDecisionKind } from "./types";

export type VisualInput = {
  labels: QueryLabel[];
  intent: UserIntent;
  /** Real measurable data exists for a graph (e.g. study minutes). */
  hasRealData: boolean;
  /** Provider image generation available. */
  imageAvailable: boolean;
};

const T = (re: RegExp, q: string) => re.test(q);

export function decideVisual(raw: string, input: VisualInput): VisualDecisionKind {
  const q = raw.toLowerCase();
  const has = (...ls: QueryLabel[]) => ls.some((l) => input.labels.includes(l));

  // Explicit asks are honored first (priority chain still applies below).
  if (has("flowchart") || T(/\bflow ?chart\b/, q)) return "flowchart";
  if (has("graph")) return input.hasRealData ? "graph" : "none";
  if (has("image")) return input.imageAvailable ? "image" : "concept_map";
  if (has("diagram")) return "concept_map";
  if (has("comparison")) return "table";

  // Implicit: processes/algorithms/workflows read better as flowcharts.
  if (has("algorithm", "step_by_step", "problem_solving") && input.intent === "apply") return "flowchart";
  // Implicit: relationships/hierarchies read better as concept maps —
  // but only when the question is about structure, not a quick fact.
  if (has("explanation", "analysis") && T(/\b(relation|hierarch|structur|overview of|types? of|classifi)\b/, q))
    return "concept_map";

  return "none";
}

/** Generation priority for the chosen visual (§10). */
export function visualPriority(kind: VisualDecisionKind): "structured" | "chart" | "image" | "none" {
  if (kind === "flowchart" || kind === "concept_map" || kind === "table") return "structured";
  if (kind === "graph") return "chart";
  if (kind === "image") return "image";
  return "none";
}
