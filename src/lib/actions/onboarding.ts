"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, uid } from "@/lib/db";
import { exams, profiles, settings, subjects, tasks, topics, units, users } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/actions";
import { ensurePlan } from "@/lib/services/plan";

const subjectStep = z.object({
  name: z.string().min(1).max(80),
  color: z.string().min(3).max(9).default("#5753d4"),
  difficulty: z.coerce.number().int().min(1).max(3).default(2),
  priority: z.coerce.number().int().min(1).max(3).default(2),
  topics: z.array(z.string().min(1).max(120)).max(60).default([]),
});

const examStep = z.object({
  name: z.string().min(1).max(120),
  subjectIndex: z.number().int().min(-1).max(20).default(-1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  importance: z.coerce.number().int().min(1).max(3).default(2),
});

const taskStep = z.object({
  title: z.string().min(1).max(160),
  kind: z.enum(["assignment", "project", "lab", "quiz", "revision", "other"]).default("assignment"),
  subjectIndex: z.number().int().min(-1).max(20).default(-1),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  estimatedMinutes: z.coerce.number().int().min(5).max(600).default(60),
});

const onboardingSchema = z.object({
  name: z.string().min(1).max(80),
  educationLevel: z.string().max(60).optional(),
  course: z.string().max(120).optional(),
  yearOfStudy: z.string().max(60).optional(),
  goals: z.string().max(500).optional(),
  subjects: z.array(subjectStep).min(1, "Add at least one subject").max(12),
  exams: z.array(examStep).max(20).default([]),
  tasks: z.array(taskStep).max(20).default([]),
  weekdayHours: z.coerce.number().min(0.5).max(12),
  weekendHours: z.coerce.number().min(0.5).max(12),
  preferredTimes: z.array(z.enum(["morning", "afternoon", "evening", "night"])).min(1),
  sessionStyle: z.enum(["short", "pomodoro", "deep", "mixed"]).default("mixed"),
  dailyGoalMinutes: z.coerce.number().int().min(30).max(720).default(240),
});

const COLORS = ["#5753d4", "#8b5cf6", "#0ea5e9", "#10b981", "#f59e0b", "#f43f5e", "#ec4899", "#6366f1"];

export async function completeOnboardingAction(input: z.infer<typeof onboardingSchema>) {
  const user = await requireUser();
  const parsed = onboardingSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 3);
    return { ok: false as const, error: issues.join(" · ") };
  }
  const d = parsed.data;
  const now = new Date().toISOString();

  await db
    .update(users)
    .set({ name: d.name, onboarded: true, updatedAt: now })
    .where(eq(users.id, user.id))
    .run();
  await db
    .update(profiles)
    .set({
      educationLevel: d.educationLevel || null,
      course: d.course || null,
      yearOfStudy: d.yearOfStudy || null,
      studyGoals: d.goals || null,
      weekdayHours: d.weekdayHours,
      weekendHours: d.weekendHours,
      preferredTimes: JSON.stringify(d.preferredTimes),
      sessionStyle: d.sessionStyle,
      updatedAt: now,
    })
    .where(eq(profiles.userId, user.id))
    .run();
  await db
    .update(settings)
    .set({ dailyGoalMinutes: d.dailyGoalMinutes, updatedAt: now })
    .where(eq(settings.userId, user.id))
    .run();

  // Subjects + syllabus
  const createdSubjectIds: string[] = [];
  for (const [i, s] of d.subjects.entries()) {
    const sid = uid();
    createdSubjectIds.push(sid);
    await db.insert(subjects).values({
      id: sid,
      userId: user.id,
      name: s.name,
      color: s.color.startsWith("#") ? s.color : COLORS[i % COLORS.length],
      priority: s.priority,
      difficulty: s.difficulty,
      sortOrder: i,
    });
    if (s.topics.length) {
      const unitId = uid();
      await db.insert(units).values({ id: unitId, subjectId: sid, name: "Syllabus", sortOrder: 0 });
      for (const [ti, topicName] of s.topics.entries()) {
        await db.insert(topics).values({
          id: uid(),
          unitId,
          name: topicName,
          status: "not_started",
          difficulty: 3,
          weight: 1,
          sortOrder: ti,
        });
      }
    }
  }

  for (const ex of d.exams) {
    await db.insert(exams).values({
      id: uid(),
      userId: user.id,
      name: ex.name,
      subjectId: ex.subjectIndex >= 0 ? createdSubjectIds[ex.subjectIndex] ?? null : null,
      date: ex.date,
      importance: ex.importance,
    });
  }

  for (const t of d.tasks) {
    await db.insert(tasks).values({
      id: uid(),
      userId: user.id,
      title: t.title,
      kind: t.kind,
      subjectId: t.subjectIndex >= 0 ? createdSubjectIds[t.subjectIndex] ?? null : null,
      deadline: t.deadline,
      priority: 2,
      estimatedMinutes: t.estimatedMinutes,
      status: "todo",
    });
  }

  await ensurePlan(user.id, 7);
  redirect("/app");
}