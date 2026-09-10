"use server";

import { addTaskAction, completeTaskByTitleAction } from "@/lib/actions/curriculum";
import { regeneratePlanAction, rescheduleMissedAction } from "@/lib/actions/planning";
import { markNotificationsReadAction } from "@/lib/actions/settings";
import type { AgentAction, AgentActionResult } from "@/lib/voice/action-types";

export async function executeVoiceAction(action: AgentAction): Promise<AgentActionResult> {
  switch (action.type) {
    case "create_task": {
      const result = await addTaskAction({
        title: action.title,
        kind: action.kind,
        deadline: action.deadline,
        priority: action.priority,
        estimatedMinutes: action.estimatedMinutes,
        notes: action.notes,
      });
      return result.ok ? { ok: true, message: `Created ${action.kind} task: ${action.title}.` } : result;
    }
    case "complete_task": {
      const result = await completeTaskByTitleAction(action.title);
      return result.ok ? { ok: true, message: `Marked ${action.title} complete.` } : result;
    }
    case "regenerate_plan": {
      const result = await regeneratePlanAction();
      return result.ok ? { ok: true, message: "Regenerated your study plan." } : { ok: false, error: "I couldn't regenerate the plan." };
    }
    case "reschedule_missed": {
      const result = await rescheduleMissedAction();
      const summary = Array.isArray(result.summary) ? result.summary.join(" ") : result.summary;
      return result.ok ? { ok: true, message: summary || "Rescheduled your missed study blocks." } : { ok: false, error: "I couldn't reschedule the missed blocks." };
    }
    case "mark_notifications_read": {
      const result = await markNotificationsReadAction();
      return result.ok ? { ok: true, message: "Marked your notifications as read." } : { ok: false, error: "I couldn't update your notifications." };
    }
    case "skip_plan":
      return { ok: false, error: "Skipping a study block by title needs a matching plan item. Open Today's Plan to choose it." };
  }
}