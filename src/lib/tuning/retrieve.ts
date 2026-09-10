/* ──────────────────────────────────────────────────────────────
   Tuning retrieval + personalized answering.

   Every query is scoped by authenticated userId first, then knowledge
   base. Retrieved passages (never the whole library) plus authorized
   progress signals form the context; the composer prefers tuned
   material, says so openly, and admits when the uploads don't cover
   a question instead of inventing coverage.
   ────────────────────────────────────────────────────────────── */

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  achievements,
  knowledgeBases,
  knowledgeChunks,
  quizAttempts,
  studySessions,
  subjects,
  topics,
  units,
  userAchievements,
} from "@/lib/db/schema";
import { cosine, embedTexts, localEmbed, parseEmbedding } from "./embed";
import { type TuningProfile } from "./patterns";
import { type QueryPlan } from "./query";
import { getAnalytics } from "@/lib/services/analytics";

export type RetrievedChunk = {
  docName: string;
  section: string | null;
  content: string;
  score: number;
};

export type TuningScope = {
  kbId: string | null;
  kbName: string | null;
  source: "provider" | "local" | "mixed";
};

async function kbSourceOf(kbId: string): Promise<"provider" | "local"> {
  const kb = (await db.select({ s: knowledgeBases.embeddingSource }).from(knowledgeBases).where(eq(knowledgeBases.id, kbId)).limit(1).all())[0];
  return kb?.s === "provider" ? "provider" : "local";
}

/** Scoped semantic retrieval. Never searches across users. */
export async function retrieveTuningChunks(
  userId: string,
  kbId: string | null,
  query: string,
  k = 6,
): Promise<{ chunks: RetrievedChunk[]; scope: TuningScope }> {
  const where = kbId
    ? and(eq(knowledgeChunks.userId, userId), eq(knowledgeChunks.kbId, kbId))
    : eq(knowledgeChunks.userId, userId);
  const rows = await db
    .select({
      kbId: knowledgeChunks.kbId,
      content: knowledgeChunks.content,
      section: knowledgeChunks.section,
      embedding: knowledgeChunks.embedding,
      docId: knowledgeChunks.docId,
    })
    .from(knowledgeChunks)
    .where(where)
    .limit(4000)
    .all();
  if (!rows.length) {
    const kb = kbId ? (await db.select().from(knowledgeBases).where(eq(knowledgeBases.id, kbId)).limit(1).all())[0] : null;
    return { chunks: [], scope: { kbId, kbName: kb?.name ?? null, source: "local" } };
  }

  const docNames = new Map<string, string>();
  const docIds = [...new Set(rows.map((r) => r.docId))];
  if (docIds.length) {
    const { knowledgeDocuments } = await import("@/lib/db/schema");
    const docs = await db
      .select({ id: knowledgeDocuments.id, fileName: knowledgeDocuments.fileName })
      .from(knowledgeDocuments)
      .where(inArray(knowledgeDocuments.id, docIds))
      .all();
    for (const d of docs) docNames.set(d.id, d.fileName);
  }

  // Embed the query once per source present in scope (local always works).
  const sources = new Set<string>();
  if (kbId) sources.add(await kbSourceOf(kbId));
  else {
    const kbIds = [...new Set(rows.map((r) => r.kbId))];
    for (const id of kbIds.slice(0, 12)) sources.add(await kbSourceOf(id));
  }
  const queryVecs = new Map<string, number[]>();
  queryVecs.set("local", localEmbed(query));
  if (sources.has("provider")) {
    const r = await embedTexts([query.slice(0, 2000)]);
    if (r.source === "provider") queryVecs.set("provider", r.vectors[0]!);
  }

  const kbOf = new Map<string, "provider" | "local">();
  const scored = rows.map((r) => {
    const vec = parseEmbedding(r.embedding);
    let src = kbOf.get(r.kbId);
    if (!src) {
      src = "local";
      kbOf.set(r.kbId, src);
    }
    return { r, vec };
  });
  // Resolve each row's KB source lazily but cheaply: reuse kbSourceOf cache.
  const srcCache = new Map<string, "provider" | "local">();
  const ranked: (RetrievedChunk & { kb: string })[] = [];
  for (const { r, vec } of scored) {
    if (!vec.length) continue;
    let src = srcCache.get(r.kbId);
    if (!src) {
      src = await kbSourceOf(r.kbId);
      srcCache.set(r.kbId, src);
    }
    const qv = queryVecs.get(src) ?? queryVecs.get("local")!;
    const score = cosine(qv, vec);
    if (score <= 0.02) continue;
    ranked.push({
      docName: docNames.get(r.docId) ?? "document",
      section: r.section,
      content: r.content,
      score,
      kb: r.kbId,
    });
  }
  ranked.sort((a, b) => b.score - a.score);
  const top = ranked.slice(0, Math.max(1, k));

  let kbName: string | null = null;
  if (kbId) {
    kbName = (await db.select({ n: knowledgeBases.name }).from(knowledgeBases).where(eq(knowledgeBases.id, kbId)).limit(1).all())[0]?.n ?? null;
  }
  return {
    chunks: top,
    scope: { kbId, kbName, source: sources.size > 1 ? "mixed" : ([...sources][0] as TuningScope["source"]) ?? "local" },
  };
}

export type TuningPersonalization = {
  streakDays: number;
  weekMinutes: number;
  weakAreas: { subject: string; topic: string }[];
  strongAreas: { subject: string; topic: string }[];
  recentSubjects: string[];
  achievementsUnlocked: number;
  quizAccuracy: number | null;
  detailLevel: "short" | "medium" | "detailed";
};

/** Authorized progress signals only — nothing invented. */
export async function getTuningPersonalization(userId: string): Promise<TuningPersonalization> {
  const { getAppData } = await import("@/lib/services/data");
  const { tuningPrefs } = await import("@/lib/db/schema");
  let streakDays = 0;
  let weakAreas: TuningPersonalization["weakAreas"] = [];
  let strongAreas: TuningPersonalization["strongAreas"] = [];
  try {
    const data = await getAppData(userId);
    streakDays = data.streak ?? 0;
    weakAreas = data.subjects.flatMap((s) => s.weakTopics.slice(0, 2).map((w) => ({ subject: s.name, topic: w.name }))).slice(0, 5);
    strongAreas = data.subjects
      .flatMap((s) =>
        (s.units ?? [])
          .flatMap((u) => u.topics ?? [])
          .filter((t) => t.status === "completed")
          .slice(0, 2)
          .map((t) => ({ subject: s.name, topic: t.name })),
      )
      .slice(0, 5);
  } catch {
    /* app-data failure must not break Tuning */
  }
  let weekMinutes = 0;
  try {
    const a = await getAnalytics(userId);
    weekMinutes = a.week.reduce((sum, d) => sum + (d.minutes ?? 0), 0);
  } catch {
    /* analytics failure must not break Tuning */
  }
  const recent = await db
    .select({ subjectId: studySessions.subjectId })
    .from(studySessions)
    .where(eq(studySessions.userId, userId))
    .orderBy(desc(studySessions.startedAt))
    .limit(20)
    .all();
  const recentSubjects: string[] = [];
  if (recent.length) {
    const ids = [...new Set(recent.map((r) => r.subjectId).filter((s): s is string => Boolean(s)))];
    if (ids.length) {
      const names = await db.select({ id: subjects.id, name: subjects.name }).from(subjects).where(inArray(subjects.id, ids)).all();
      const byId = new Map(names.map((n) => [n.id, n.name]));
      for (const id of ids) {
        const n = byId.get(id);
        if (n && !recentSubjects.includes(n)) recentSubjects.push(n);
      }
    }
  }
  void achievements;
  void userAchievements;
  void topics;
  void units;
  const unlocked = await db
    .select({ u: userAchievements.unlockedAt })
    .from(userAchievements)
    .where(eq(userAchievements.userId, userId))
    .all();
  const attempts = await db.select().from(quizAttempts).where(eq(quizAttempts.userId, userId)).orderBy(desc(quizAttempts.createdAt)).limit(10).all();
  const answered = attempts.reduce((s, a) => s + (a.questionCount ?? 0), 0);
  const correct = attempts.reduce((s, a) => s + (a.correctCount ?? 0), 0);
  const pref = (await db.select().from(tuningPrefs).where(eq(tuningPrefs.userId, userId)).limit(1).all())[0];
  return {
    streakDays,
    weekMinutes,
    weakAreas,
    strongAreas,
    recentSubjects: recentSubjects.slice(0, 3),
    achievementsUnlocked: unlocked.filter((u) => u.u).length,
    quizAccuracy: answered > 0 ? Math.round((correct / answered) * 100) : null,
    detailLevel: (pref?.detailLevel as TuningPersonalization["detailLevel"]) ?? "medium",
  };
}

export type TuningAnswer = {
  markdown: string;
  mermaid: string | null;
  conceptMap: { nodes: string[]; edges: { from: string; to: string }[] } | null;
  activityGraph: { label: string; minutes: number }[] | null;
  tunedCoverage: boolean;
  sourcesUsed: string[];
};

const quote = (c: RetrievedChunk, max = 320) =>
  `> ${c.content.replace(/\s+/g, " ").trim().slice(0, max)}${c.content.length > max ? "…" : ""}\n> — *${c.docName}${c.section ? ` · ${c.section}` : ""}*`;

function mermaidFlow(title: string, steps: string[]): string {
  const safe = (s: string) => s.replace(/["#<>`|]/g, "").trim().slice(0, 60) || "step";
  const lines = steps.slice(0, 8).map((s, i) => `  S${i}["${safe(s)}"]`);
  const links = steps.slice(0, 8).map((_, i) => (i === 0 ? "  START((start)) --> S0" : `  S${i - 1} --> S${i}`));
  return [`flowchart TD`, `  %% ${title.slice(0, 60)}`, ...links, ...lines].join("\n");
}

function mermaidConcepts(nodes: string[], edges: { from: string; to: string }[]): string {
  const id = (n: string, i: number) => `N${i}`;
  const idx = new Map(nodes.map((n, i) => [n, i]));
  const lines = nodes.slice(0, 10).map((n, i) => `  ${id(n, i)}["${n.slice(0, 40)}"]`);
  const links = edges
    .filter((e) => idx.has(e.from) && idx.has(e.to))
    .slice(0, 12)
    .map((e) => `  N${idx.get(e.from)} --- N${idx.get(e.to)}`);
  return ["graph TD", ...lines, ...links].join("\n");
}

function numberedSteps(chunks: RetrievedChunk[]): string[] {
  const steps: string[] = [];
  for (const c of chunks) {
    const matches = c.content.match(/(?:^|\n)\s*(?:step\s*\d+|\d+[.)])\s*([^.\n]{8,90})/gi);
    if (matches) for (const m of matches.slice(0, 3)) steps.push(m.replace(/^\s*(step\s*\d+|\d+[.)])\s*/i, "").trim());
    if (steps.length >= 8) break;
  }
  return steps;
}

/** Deterministic composer — grounded quotes first, honesty when thin. */
export async function composeTuningAnswer(input: {
  query: string;
  plan: QueryPlan;
  chunks: RetrievedChunk[];
  profile: TuningProfile;
  scope: TuningScope;
  me: TuningPersonalization;
  userName: string;
  userId: string;
}): Promise<TuningAnswer> {
  const { query, plan, chunks, profile, scope, me, userId } = input;
  const kbLabel = scope.kbName ? `your tuned ${scope.kbName} materials` : "your tuned materials";
  const covered = chunks.length >= 2 || (chunks.length === 1 && chunks[0]!.score > 0.12);
  const sourcesUsed = [...new Set(chunks.map((c) => c.docName))];
  const lines: string[] = [];
  let mermaid: string | null = null;
  let conceptMap: TuningAnswer["conceptMap"] = null;
  let activityGraph: TuningAnswer["activityGraph"] = null;

  const contextLine =
    me.weakAreas.length || me.recentSubjects.length
      ? `\n\n_Personal note: ${me.recentSubjects.length ? `you have been studying ${me.recentSubjects.join(", ")} lately` : "noted"}${
          me.weakAreas.length ? `, and ${me.weakAreas.slice(0, 2).map((w) => `${w.topic} (${w.subject})`).join(", ")} still needs work — so this answer leans there` : ""
        }._`
      : "";

  if (!covered) {
    lines.push(
      `Your uploads do not explain this part in detail yet — I found ${chunks.length === 0 ? "nothing relevant" : "only a passing mention"} in ${kbLabel}.`,
      "",
      "Two honest options:",
      "1. Upload the chapter or lecture notes that cover it, then ask again.",
      "2. Ask me to explain it from general knowledge, and I will clearly mark which parts are not from your materials.",
    );
    return { markdown: lines.join("\n"), mermaid, conceptMap, activityGraph, tunedCoverage: false, sourcesUsed };
  }

  lines.push(`Answering from ${kbLabel} (${chunks.length} passage${chunks.length === 1 ? "" : "s"}).`, "");

  const maxChars = plan.complexity === "short" ? 1 : plan.complexity === "medium" ? 3 : 5;
  const shown = chunks.slice(0, maxChars);

  if (plan.type === "definition") {
    const term = plan.keywordTerms[0];
    const def = term ? profile.definitions.find((d) => d.term.toLowerCase().includes(term) || term.includes(d.term.toLowerCase().split(" ")[0]!)) : undefined;
    if (def) {
      lines.push(`**${def.term}** — ${def.text}`, "", quote(shown[0]!));
    } else {
      lines.push(quote(shown[0]!), "");
      if (shown[1]) lines.push(quote(shown[1]!));
    }
  } else if (plan.type === "comparison") {
    lines.push(`| Aspect | What your materials say |`, `|---|---|`);
    for (const c of shown.slice(0, 4)) {
      lines.push(`| ${c.section ?? c.docName} | ${c.content.replace(/\s+/g, " ").trim().slice(0, 140)}… |`);
    }
    lines.push("", "_Side-by-side detail is quoted per source so nothing is blended silently._");
  } else if (plan.type === "revision" || plan.type === "summary") {
    lines.push(`**Key points from your materials:**`, "");
    const points = profile.coreConcepts.filter((c) => plan.keywordTerms.some((k) => c.term.includes(k.slice(0, 6)) || k.includes(c.term))).slice(0, 5);
    const list = points.length ? points : profile.coreConcepts.slice(0, 5);
    for (const p of list) lines.push(`- **${p.term}** — appears ${p.count} time${p.count === 1 ? "" : "s"} across ${p.docs} document${p.docs === 1 ? "" : "s"}`);
    if (profile.questionPatterns.count > 0) {
      lines.push("", `_Your documents contain about ${profile.questionPatterns.count} question or exercise cues${profile.questionPatterns.sample ? `, e.g. “${profile.questionPatterns.sample.slice(0, 120)}”` : ""} — expect these to be examined._`);
    }
    lines.push("", quote(shown[0]!));
  } else {
    // explanation / problem solving / default: guided walkthrough + quotes.
    const cap = plan.complexity === "detailed" ? "Here is the full picture from your materials:" : "Here is what matters from your materials:";
    lines.push(cap, "");
    for (const c of shown) lines.push(quote(c), "");
  }

  if (plan.visual === "flowchart") {
    const steps = numberedSteps(chunks);
    const flow = steps.length >= 2 ? steps : shown.map((c) => c.section ?? c.docName);
    mermaid = mermaidFlow(query, flow);
    lines.push("**Process map** (built from your documents, in order):", "", "```mermaid", mermaid, "```");
  } else if (plan.visual === "concept_map") {
    const queryTerms = new Set(plan.keywordTerms.map((t) => t.slice(0, 8)));
    const nodes = profile.coreConcepts.filter((c) => [...queryTerms].some((k) => c.term.includes(k) || k.includes(c.term))).slice(0, 8).map((c) => c.term);
    const seed = nodes.length >= 2 ? nodes : profile.coreConcepts.slice(0, 6).map((c) => c.term);
    const edges = profile.relationships.filter((r) => seed.includes(r.from) && seed.includes(r.to)).slice(0, 10);
    conceptMap = { nodes: seed, edges };
    mermaid = mermaidConcepts(seed, edges);
    lines.push("**Concept map** (relationships counted across your documents):", "", "```mermaid", mermaid, "```");
  } else if (plan.visual === "graph") {
    // Real-data graphs only: measured study minutes per week (8-week history).
    try {
      const a = await getAnalytics(userId);
      activityGraph = a.week.map((d) => ({ label: d.label ?? "", minutes: d.minutes ?? 0 }));
      lines.push(`**Your measured study time** (real data from your sessions, not illustrative):`, "");
      lines.push(`| Week | Minutes |`, `|---|---|`);
      for (const d of activityGraph) lines.push(`| ${d.label} | ${d.minutes} |`);
    } catch {
      lines.push(
        "_I could not load your measured activity just now. Paste the numbers you want plotted and I will chart exactly those — never invented data._",
      );
    }
  }

  lines.push(contextLine);
  return { markdown: lines.join("\n").trim(), mermaid, conceptMap, activityGraph, tunedCoverage: true, sourcesUsed };
}
