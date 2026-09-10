/* ──────────────────────────────────────────────────────────────
   Tuning query understanding — classify first, then answer.

   Determines question type, complexity, knowledge source, and
   whether a visual earns its place (flowchart / concept map /
   comparison table / real-data graph) instead of plain text.
   ────────────────────────────────────────────────────────────── */

export type QuestionType =
  | "definition"
  | "explanation"
  | "comparison"
  | "problem_solving"
  | "revision"
  | "summary"
  | "diagram"
  | "flowchart"
  | "graph";

export type VisualKind = "none" | "flowchart" | "concept_map" | "table" | "graph";

export type QueryPlan = {
  type: QuestionType;
  complexity: "short" | "medium" | "detailed";
  visual: VisualKind;
  wantsVisual: boolean;
  keywordTerms: string[];
};

const T = (re: RegExp, q: string) => re.test(q);

export function classifyQuery(raw: string, detailPref: "short" | "medium" | "detailed"): QueryPlan {
  const q = raw.toLowerCase();
  let type: QuestionType = "explanation";
  if (T(/\b(flow ?chart|process flow|steps? (to|for)|algorithm steps|procedure)\b/, q)) type = "flowchart";
  else if (T(/\b(diagram|concept map|mind ?map|illustrat|visualiz|visualise|draw|picture of)\b/, q)) type = "diagram";
  else if (T(/\b(graph|chart|plot|trend|distribution|histogram)\b/, q)) type = "graph";
  else if (T(/\b(compare|comparison|difference between|vs\.?|versus|pros and cons|advantages)/, q)) type = "comparison";
  else if (T(/\b(solve|solution|calculate|compute|derive|prove|problem|exercise|example problem)\b/, q)) type = "problem_solving";
  else if (T(/\b(revise|revision|recap|review|cheat ?sheet|key points|exam prep|important topics)\b/, q)) type = "revision";
  else if (T(/\b(summariz|summaris|summary|overview|tldr|in brief|outline)\b/, q)) type = "summary";
  else if (T(/\b(what is|what are|define|definition|meaning of|who is)\b/, q)) type = "definition";

  let complexity: QueryPlan["complexity"] = detailPref;
  if (T(/\b(brief(ly)?|short|quick(ly)?|one ?line|in a sentence)\b/, q)) complexity = "short";
  else if (T(/\b(detail|in[- ]depth|thorough|step[- ]by[- ]step|explain fully|elaborate)\b/, q)) complexity = "detailed";
  else if (type === "definition") complexity = "short";

  const wantsVisual =
    type === "flowchart" ||
    type === "diagram" ||
    type === "graph" ||
    type === "comparison" ||
    T(/\b(with|as|include|show|using|add)\b.{0,24}\b(flow ?chart|diagram|table|graph|map)\b/, q);

  const visual: VisualKind =
    type === "flowchart" ? "flowchart" : type === "diagram" ? "concept_map" : type === "graph" ? "graph" : type === "comparison" ? "table" : wantsVisual ? "concept_map" : "none";

  return { type, complexity, visual, wantsVisual, keywordTerms: keywordTermsOf(q) };
}

const QUESTION_WORDS = new Set(
  "what,whats,when,where,which,while,how,why,who,whom,whose,does,do,is,are,was,were,can,could,should,would,will,explain,describe,define,meaning,tell,about,with,from,that,this,these,those,there,their,have,has,there,please,show,give".split(","),
);

/** Content-bearing keywords — question words and fillers excluded. */
export function keywordTermsOf(q: string): string[] {
  return q
    .replace(/[^a-z0-9+# ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !QUESTION_WORDS.has(w))
    .slice(0, 12);
}

/** Match a subject hint against the user's KB names (case-insensitive). */
export function matchKnowledgeBase(query: string, bases: { id: string; name: string }[]): string | null {
  const q = query.toLowerCase();
  let best: { id: string; score: number } | null = null;
  for (const b of bases) {
    const name = b.name.toLowerCase();
    if (!name) continue;
    if (q.includes(name)) return b.id; // exact mention wins outright
    const parts = name.split(/\s+/).filter((w) => w.length >= 4);
    const hits = parts.filter((p) => q.includes(p)).length;
    if (hits > 0 && (!best || hits > best.score)) best = { id: b.id, score: hits };
  }
  return best?.id ?? null;
}
