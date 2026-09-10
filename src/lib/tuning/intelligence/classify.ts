/* ──────────────────────────────────────────────────────────────
   §6 — Multi-label question classification.

   A question may carry several labels ("Explain Dijkstra with a
   flowchart" → explanation + algorithm + flowchart). Downstream
   stages read the full set; nothing forces one category.
   ────────────────────────────────────────────────────────────── */

import type { QueryLabel } from "./types";

const T = (re: RegExp, q: string) => re.test(q);

const RULES: { label: QueryLabel; re: RegExp }[] = [
  { label: "flowchart", re: /\b(flow ?chart|process flow|algorithm steps|procedure|steps? (to|for))\b/ },
  { label: "diagram", re: /\b(diagram|concept map|mind ?map|illustrat|visualiz|visualise|draw|picture of)\b/ },
  { label: "graph", re: /\b(graph|chart|plot|trend|distribution|histogram)\b/ },
  { label: "image", re: /\b(image|photo|picture|illustration|draw (me|an?|a)|generate (an? )?image)\b/ },
  {
    label: "comparison",
    re: /\b(compare|comparison|difference between|vs\.?|versus|pros and cons|advantages|disadvantages|similarities)\b/,
  },
  {
    label: "problem_solving",
    re: /\b(solve|solution|calculate|compute|derive|prove|problem|exercise|example problem|work through|find the)\b/,
  },
  {
    label: "revision",
    re: /\b(revise|revision|recap|review|cheat ?sheet|key points|exam prep|important topics|quick revision)\b/,
  },
  { label: "summary", re: /\b(summariz|summaris|summary|overview|tldr|in brief|outline|gist)\b/ },
  { label: "definition", re: /\b(what is|what are|define|definition|meaning of|who is|what does .+ mean)\b/ },
  {
    label: "step_by_step",
    re: /\b(step[- ]by[- ]step|walk ?through|how (do|does|to)|tutorial|guide me|stages? of)\b/,
  },
  { label: "example", re: /\b(example|sample|instance|illustrate|e\.g\.|for example|show me .+ example)\b/ },
  {
    label: "code",
    re: /\b(code|function|program|implement|script|debug|syntax|pseudo ?code|algorithm implementation)\b/,
  },
  {
    label: "algorithm",
    re: /\b(algorithm|complexity|big-?o|recurrence|traversal|sorting|searching|dynamic programming|greedy)\b/,
  },
  {
    label: "analysis",
    re: /\b(analy[sz]e|analysis|evaluate|critique|pros|trade[- ]off|why does|what causes|implications)\b/,
  },
  { label: "explanation", re: /\b(explain|elucidate|describe|tell me about|clarify|elaborate|understand)\b/ },
];

/**
 * Classify a question into all matching labels, most-specific first.
 * A bare question with no signal defaults to ["explanation"].
 */
export function classifyAdvanced(raw: string): QueryLabel[] {
  const q = raw.toLowerCase();
  const labels = RULES.filter((r) => T(r.re, q)).map((r) => r.label);
  if (!labels.length) return ["explanation"];
  return [...new Set(labels)];
}

/** Primary label = first (most specific by rule order above). */
export function primaryLabel(labels: QueryLabel[]): QueryLabel {
  return labels[0] ?? "explanation";
}
