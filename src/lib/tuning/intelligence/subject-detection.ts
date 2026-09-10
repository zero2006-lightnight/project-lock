/* ──────────────────────────────────────────────────────────────
   §5 — Subject detection with strict priority:

     Explicit User Selection → Current Workspace → Conversation
     Context → Automatic Detection (fallback: most-recent ready base)

   Rule: an explicit user selection is NEVER overridden. Automatic
   detection only fills the gap when the user did not choose.
   ────────────────────────────────────────────────────────────── */

import type { ResolvedSubject } from "./types";
import { matchKnowledgeBase } from "../query";

export type KnowledgeBaseRef = { id: string; name: string };

export type SubjectDetectionInput = {
  /** Explicit KB picked in the UI (select control). Null = not chosen. */
  explicitKbId: string | null;
  /** Current workspace KB (the open knowledge base), if any. */
  workspaceKbId: string | null;
  /** Recent tuning queries in this session (oldest → newest). */
  recentQueries: string[];
  /** The current question (sanitized). */
  question: string;
  /** All of the user's KBs (already scoped to this user — never cross-user). */
  bases: KnowledgeBaseRef[];
};

export function resolveSubject(input: SubjectDetectionInput): ResolvedSubject {
  const byId = new Map(input.bases.map((b) => [b.id, b]));

  // 1. Explicit selection wins outright — never overridden, never "corrected".
  if (input.explicitKbId) {
    const kb = byId.get(input.explicitKbId) ?? null;
    return {
      kbId: input.explicitKbId,
      kbName: kb?.name ?? null,
      source: "explicit",
      explicitOverridden: false,
    };
  }

  // 2. Current workspace.
  if (input.workspaceKbId && byId.has(input.workspaceKbId)) {
    return {
      kbId: input.workspaceKbId,
      kbName: byId.get(input.workspaceKbId)!.name,
      source: "workspace",
      explicitOverridden: false,
    };
  }

  // 3. Conversation context — the most recent query that names a KB.
  for (let i = input.recentQueries.length - 1; i >= 0; i--) {
    const hit = matchKnowledgeBase(input.recentQueries[i]!, input.bases);
    if (hit) {
      return {
        kbId: hit,
        kbName: byId.get(hit)?.name ?? null,
        source: "conversation",
        explicitOverridden: false,
      };
    }
  }

  // 4. Automatic detection from the current question.
  const auto = matchKnowledgeBase(input.question, input.bases);
  if (auto) {
    return {
      kbId: auto,
      kbName: byId.get(auto)?.name ?? null,
      source: "auto",
      explicitOverridden: false,
    };
  }

  // 5. Fallback: no signal at all — caller defaults to the most-recent
  //    ready base and says so openly (never claims detection).
  return { kbId: null, kbName: null, source: "fallback", explicitOverridden: false };
}
