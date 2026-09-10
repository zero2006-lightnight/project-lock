import { and, eq } from "drizzle-orm";
import { db, uid } from "@/lib/db";
import { planItems, studySessions, topics } from "@/lib/db/schema";

export type RecordSessionInput = {
  subjectId?: string | null;
  topicId?: string | null;
  planItemId?: string | null;
  kind?: "focus" | "manual" | "quick";
  startedAt: string;
  endedAt?: string | null;
  durationMinutes: number;
  completed: boolean;
};

/**
 * Persists a study session. When it was started from a planned block the
 * block is completed, and the topic's lastStudiedAt is refreshed so the
 * planner's freshness signal stays honest.
 */
export async function recordSession(userId: string, input: RecordSessionInput): Promise<string> {
  const now = new Date().toISOString();
  const id = uid();

  await db.insert(studySessions).values({
    id,
    userId,
    subjectId: input.subjectId ?? null,
    topicId: input.topicId ?? null,
    planItemId: input.planItemId ?? null,
    kind: input.kind ?? "focus",
    startedAt: input.startedAt,
    endedAt: input.endedAt ?? now,
    durationMinutes: Math.max(1, Math.round(input.durationMinutes)),
    completed: input.completed,
  });

  if (input.planItemId) {
    const [item] = await db
      .select()
      .from(planItems)
      .where(and(eq(planItems.id, input.planItemId), eq(planItems.userId, userId)))
      .limit(1)
      .all();
    if (item && item.status !== "completed") {
      await db
        .update(planItems)
        .set({ status: "completed", completedAt: now, updatedAt: now })
        .where(eq(planItems.id, item.id))
        .run();
    }
  }

  const touchTopicId = input.topicId ?? (input.planItemId ? (await planTopicOf(input.planItemId, userId)) : null);
  if (touchTopicId) {
    await db.update(topics).set({ lastStudiedAt: now, updatedAt: now }).where(eq(topics.id, touchTopicId)).run();
  }

  return id;
}

async function planTopicOf(planItemId: string, userId: string): Promise<string | null> {
  const [item] = await db
    .select({ topicId: planItems.topicId })
    .from(planItems)
    .where(and(eq(planItems.id, planItemId), eq(planItems.userId, userId)))
    .limit(1)
    .all();
  return item?.topicId ?? null;
}

/** Reopen a paused focus session as incomplete (or discard entirely). */
export async function abortSession(sessionId: string, userId: string): Promise<void> {
  await db
    .delete(studySessions)
    .where(and(eq(studySessions.id, sessionId), eq(studySessions.userId, userId)))
    .run();
}
