"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/actions";
import {
  completePlanItem,
  ensurePlan,
  movePlanItem,
  postponePlanItem,
  rescheduleMissedPlan,
  skipPlanItem,
} from "@/lib/services/plan";
import { recordSession } from "@/lib/services/activity";
import { refreshAchievements } from "@/lib/services/achievements";

export async function completePlanItemAction(itemId: string) {
  const user = await requireUser();
  await completePlanItem(user.id, itemId);
  const unlocked = await refreshAchievements(user.id);
  revalidatePath("/app", "layout");
  return { ok: true as const, unlocked: unlocked.map((u) => u.title) };
}

export async function skipPlanItemAction(itemId: string) {
  const user = await requireUser();
  await skipPlanItem(user.id, itemId);
  revalidatePath("/app", "layout");
  return { ok: true as const };
}

export async function postponePlanItemAction(itemId: string, days = 1) {
  const user = await requireUser();
  const moved = await postponePlanItem(user.id, itemId, days);
  revalidatePath("/app", "layout");
  return { ok: moved as boolean, error: moved ? undefined : "No spare capacity on the next days — try skipping instead." };
}

const movePlanSchema = z.object({
  itemId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  /** Optional time-of-day placement, minutes from midnight. */
  startMinutes: z.coerce.number().int().min(0).max(1439).optional(),
});

/** Drag-and-drop reschedule: move a pending block to a day, optionally at a specific time. */
export async function movePlanItemAction(itemId: string, date: string, startMinutes?: number) {
  const user = await requireUser();
  const parsed = movePlanSchema.safeParse({ itemId, date, startMinutes });
  if (!parsed.success) return { ok: false as const, error: "Invalid move request." };
  const res = await movePlanItem(user.id, parsed.data.itemId, parsed.data.date, parsed.data.startMinutes);
  revalidatePath("/app", "layout");
  if (!res.ok) return { ok: false as const, error: res.error };
  return { ok: true as const, moved: res.moved };
}

export async function regeneratePlanAction() {
  const user = await requireUser();
  const count = await ensurePlan(user.id, 7, true);
  revalidatePath("/app", "layout");
  return { ok: true as const, count };
}

export async function rescheduleMissedAction() {
  const user = await requireUser();
  const result = await rescheduleMissedPlan(user.id);
  revalidatePath("/app", "layout");
  return { ok: true as const, moved: result.moved, summary: result.summary };
}

const focusSchema = z.object({
  planItemId: z.string().nullable().optional(),
  subjectId: z.string().nullable().optional(),
  topicId: z.string().nullable().optional(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  durationMinutes: z.coerce.number().int().min(1).max(600),
  completed: z.coerce.boolean().default(true),
});

export async function finishFocusAction(input: z.infer<typeof focusSchema>) {
  const user = await requireUser();
  const parsed = focusSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid session data" };

  await recordSession(user.id, {
    planItemId: parsed.data.planItemId ?? null,
    subjectId: parsed.data.subjectId ?? null,
    topicId: parsed.data.topicId ?? null,
    kind: "focus",
    startedAt: parsed.data.startedAt,
    endedAt: parsed.data.endedAt,
    durationMinutes: parsed.data.durationMinutes,
    completed: parsed.data.completed,
  });

  const unlocked = await refreshAchievements(user.id);
  revalidatePath("/app", "layout");
  return { ok: true as const, unlocked: unlocked.map((u) => u.title) };
}

export async function quickLogAction(input: { subjectId?: string | null; topicId?: string | null; minutes: number }) {
  const user = await requireUser();
  const parsed = z
    .object({ subjectId: z.string().nullable().optional(), topicId: z.string().nullable().optional(), minutes: z.coerce.number().int().min(1).max(600) })
    .safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid log" };
  const now = new Date();
  const startedAt = new Date(now.getTime() - parsed.data.minutes * 60000).toISOString();
  await recordSession(user.id, {
    subjectId: parsed.data.subjectId ?? null,
    topicId: parsed.data.topicId ?? null,
    kind: "quick",
    startedAt,
    endedAt: now.toISOString(),
    durationMinutes: parsed.data.minutes,
    completed: true,
  });
  const unlocked = await refreshAchievements(user.id);
  revalidatePath("/app", "layout");
  return { ok: true as const, unlocked: unlocked.map((u) => u.title) };
}