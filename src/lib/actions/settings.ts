"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { notifications, profiles, settings, users } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/actions";
import { ensurePlan } from "@/lib/services/plan";

export async function saveProfileAction(input: {
  educationLevel?: string;
  course?: string;
  yearOfStudy?: string;
  studyGoals?: string;
}) {
  const user = await requireUser();
  await db
    .update(profiles)
    .set({
      educationLevel: input.educationLevel || null,
      course: input.course || null,
      yearOfStudy: input.yearOfStudy || null,
      studyGoals: input.studyGoals || null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(profiles.userId, user.id))
    .run();
  revalidatePath("/app/settings");
  return { ok: true as const };
}

const availabilitySchema = z.object({
  weekdayHours: z.coerce.number().min(0.5).max(12),
  weekendHours: z.coerce.number().min(0.5).max(12),
  preferredTimes: z.array(z.enum(["morning", "afternoon", "evening", "night"])).min(1),
  sessionStyle: z.enum(["short", "pomodoro", "deep", "mixed"]),
});

export async function saveAvailabilityAction(input: z.infer<typeof availabilitySchema>) {
  const user = await requireUser();
  const parsed = availabilitySchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid availability" };
  await db
    .update(profiles)
    .set({
      weekdayHours: parsed.data.weekdayHours,
      weekendHours: parsed.data.weekendHours,
      preferredTimes: JSON.stringify(parsed.data.preferredTimes),
      sessionStyle: parsed.data.sessionStyle,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(profiles.userId, user.id))
    .run();
  await ensurePlan(user.id, 7, true);
  revalidatePath("/app/settings");
  revalidatePath("/app", "layout");
  return { ok: true as const };
}

const prefsSchema = z.object({
  theme: z.enum(["light", "dark", "system"]),
  dailyGoalMinutes: z.coerce.number().int().min(30).max(720),
  focusMinutes: z.coerce.number().int().min(5).max(120),
  breakMinutes: z.coerce.number().int().min(0).max(30),
  notificationPrefs: z.record(z.string(), z.boolean()),
});

export async function savePreferencesAction(input: z.infer<typeof prefsSchema>) {
  const user = await requireUser();
  const parsed = prefsSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid preferences" };
  await db
    .update(settings)
    .set({
      theme: parsed.data.theme,
      dailyGoalMinutes: parsed.data.dailyGoalMinutes,
      focusMinutes: parsed.data.focusMinutes,
      breakMinutes: parsed.data.breakMinutes,
      notificationPrefs: JSON.stringify(parsed.data.notificationPrefs),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(settings.userId, user.id))
    .run();
  revalidatePath("/app/settings");
  return { ok: true as const };
}

export async function markNotificationsReadAction() {
  const user = await requireUser();
  await db
    .update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.userId, user.id), eq(notifications.read, false)))
    .run();
  revalidatePath("/app", "layout");
  return { ok: true as const };
}

export async function resetDemoOrDataAction() {
  const user = await requireUser();
  await db
    .update(users)
    .set({ onboarded: false })
    .where(eq(users.id, user.id))
    .run();
  revalidatePath("/", "layout");
  return { ok: true as const };
}