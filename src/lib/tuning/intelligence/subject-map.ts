/* ──────────────────────────────────────────────────────────────
   §2 — Subject knowledge map.

   Generated from real document structure (sections), semantic
   co-occurrence (relationships), and repeated concepts — never
   hard-coded. Starts practical: section hierarchy first, then
   attaches the strongest related concepts as leaves. No claim to a
   perfect universal knowledge graph.
   ────────────────────────────────────────────────────────────── */

import type { SubjectMapNode } from "./types";

/** Minimal structural view of the stored profile (avoids a hard dep). */
export type TuningProfileLike = {
  topicTree: { title: string; chunks: number }[];
  relationships: { from: string; to: string; weight: number }[];
  coreConcepts: { term: string; count: number; docs: number }[];
};

/** Split "A > B > C" style section titles into a path; plain titles are roots. */
function titlePath(title: string): string[] {
  return title
    .split(/ *[>/|] */)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function findOrAdd(nodes: SubjectMapNode[], title: string, chunks: number): SubjectMapNode {
  const key = title.toLowerCase();
  let node = nodes.find((n) => n.title.toLowerCase() === key);
  if (!node) {
    node = { title: title.slice(0, 60), chunks: 0, children: [] };
    nodes.push(node);
  }
  node.chunks += chunks;
  return node;
}

const MAX_ROOTS = 12;
const MAX_CHILDREN = 8;
const MAX_LEAVES = 5;

/**
 * Build the subject map: section hierarchy as the skeleton, top
 * co-occurring concepts attached as evidence-counted leaves.
 */
export function buildSubjectMap(profile: TuningProfileLike): SubjectMapNode[] {
  const roots: SubjectMapNode[] = [];
  for (const t of profile.topicTree.slice(0, MAX_ROOTS * 2)) {
    const path = titlePath(t.title);
    if (!path.length) continue;
    let level = roots;
    let terminal: SubjectMapNode | null = null;
    for (const part of path) {
      terminal = findOrAdd(level, part, 0);
      level = terminal.children;
    }
    if (terminal) terminal.chunks += t.chunks;
  }

  // Cap roots by chunk weight (most-covered first).
  roots.sort((a, b) => b.chunks - a.chunks);
  const capped = roots.slice(0, MAX_ROOTS);

  // Attach strongest relationship concepts as leaves under matching roots.
  const byRoot = new Map(capped.map((r) => [r.title.toLowerCase(), r]));
  for (const rel of profile.relationships.slice(0, 20)) {
    for (const [from, to] of [
      [rel.from, rel.to],
      [rel.to, rel.from],
    ] as const) {
      const root = byRoot.get(from.slice(0, 60).toLowerCase());
      if (!root) continue;
      if (root.children.length >= MAX_CHILDREN) continue;
      if (root.children.some((c) => c.title.toLowerCase() === to.toLowerCase())) continue;
      const concept = profile.coreConcepts.find((c) => c.term === to);
      root.children.push({
        title: to.slice(0, 60),
        chunks: concept?.count ?? rel.weight,
        children: [],
      });
      if (root.children.length >= MAX_CHILDREN + MAX_LEAVES) break;
    }
  }
  return capped;
}

/** One-line readable rendering for prompts ("ML > Supervised > Regression (12)"). */
export function renderSubjectMap(nodes: SubjectMapNode[], depth = 0): string {
  const lines: string[] = [];
  for (const n of nodes.slice(0, MAX_ROOTS)) {
    lines.push(`${"  ".repeat(depth)}- ${n.title} (${n.chunks})`);
    for (const c of n.children.slice(0, MAX_CHILDREN)) {
      lines.push(`${"  ".repeat(depth + 1)}- ${c.title} (${c.chunks})`);
    }
  }
  return lines.join("\n");
}
