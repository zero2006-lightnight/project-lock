export type TaskKind = "assignment" | "project" | "lab" | "quiz" | "revision" | "other";

export type AgentAction =
  | { type: "create_task"; title: string; kind: TaskKind; deadline: string | null; priority: 1 | 2 | 3; estimatedMinutes: number; notes: string | null }
  | { type: "complete_task"; title: string }
  | { type: "skip_plan"; title?: string }
  | { type: "regenerate_plan" }
  | { type: "reschedule_missed" }
  | { type: "mark_notifications_read" };

export type AgentActionResult = { ok: true; message: string; undo?: AgentAction } | { ok: false; error: string };
