import { and, asc, count, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db, uid } from "@/lib/db";
import {
  chatConversations,
  chatMessages,
  exams,
  flashcards as flashcardsTable,
  materials as materialsTable,
  mindmaps as mindmapsTable,
  planItems,
  studySessions,
  subjects as subjectsTable,
  tasks,
  topics as topicsTable,
} from "@/lib/db/schema";
import { daysUntil, minutesToClock } from "@/lib/dates";
import type { ChatContext, ChatTopicInfo } from "@/lib/ai/types";
import { getAppData, getProfileBundle } from "./data";

/* ── Chat sessions ───────────────────────────────────────────
   Each login starts a FRESH session. The previous session is kept and
   listed as history ("wrap-up"), so nothing the student discussed is
   lost — but the active chat always starts clean.
   ──────────────────────────────────────────────────────────── */

/** The user's open session, if one exists and has messages. */
async function openSession(userId: string) {
  const rows = await db
    .select()
    .from(chatConversations)
    .where(and(eq(chatConversations.userId, userId), isNull(chatConversations.endedAt)))
    .orderBy(desc(chatConversations.createdAt))
    .limit(1)
    .all();
  return rows[0] ?? null;
}

/**
 * Session semantics: on login the previous open session is closed
 * ("wrapped up") and a fresh one starts, so the student always lands
 * in a clean chat. Old sessions remain accessible in the sidebar.
 */
export async function getOrCreateSession(userId: string): Promise<string> {
  const open = await openSession(userId);
  if (open) return open.id;

  // Wrap up any dangling sessions from an earlier run (e.g. browser closed).
  await db
    .update(chatConversations)
    .set({ endedAt: new Date().toISOString() })
    .where(and(eq(chatConversations.userId, userId), isNull(chatConversations.endedAt)))
    .run();

  const id = uid();
  const now = new Date().toISOString();
  await db.insert(chatConversations).values({
    id,
    userId,
    title: "New session",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

/** Back-compat shim used by the send action. */
export async function getOrCreateConversation(userId: string): Promise<string> {
  return getOrCreateSession(userId);
}

/** All sessions, newest first, with a preview of the first user message. */
export async function listSessions(userId: string) {
  const rows = await db
    .select({
      id: chatConversations.id,
      title: chatConversations.title,
      createdAt: chatConversations.createdAt,
      updatedAt: chatConversations.updatedAt,
      endedAt: chatConversations.endedAt,
    })
    .from(chatConversations)
    .where(eq(chatConversations.userId, userId))
    .orderBy(desc(chatConversations.updatedAt))
    .limit(30)
    .all();

  const withPreviews = await Promise.all(
    rows.map(async (s) => {
      const first = await db
        .select({ content: chatMessages.content })
        .from(chatMessages)
        .where(and(eq(chatMessages.conversationId, s.id), eq(chatMessages.role, "user")))
        .orderBy(chatMessages.createdAt)
        .limit(1)
        .all();
      const [{ c: msgCount }] = await db
        .select({ c: count() })
        .from(chatMessages)
        .where(eq(chatMessages.conversationId, s.id))
        .all();
      return {
        ...s,
        preview: first[0]?.content.slice(0, 80) ?? "Empty session",
        messageCount: msgCount ?? 0,
      };
    }),
  );
  return withPreviews;
}

/** Auto-title a session from its first user message. */
export async function maybeTitleSession(conversationId: string, firstUserMessage: string) {
  const rows = await db
    .select({ title: chatConversations.title })
    .from(chatConversations)
    .where(eq(chatConversations.id, conversationId))
    .limit(1)
    .all();
  if (rows[0]?.title && rows[0].title !== "New session") return;
  const title = firstUserMessage.replace(/\s+/g, " ").trim().slice(0, 48) || "Study session";
  await db
    .update(chatConversations)
    .set({ title, updatedAt: new Date().toISOString() })
    .where(eq(chatConversations.id, conversationId))
    .run();
}

/** Explicitly close the current session (used on logout). */
export async function closeActiveSession(userId: string) {
  await db
    .update(chatConversations)
    .set({ endedAt: new Date().toISOString() })
    .where(and(eq(chatConversations.userId, userId), isNull(chatConversations.endedAt)))
    .run();
}

export async function recentMessages(conversationId: string, limit = 40) {
  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId))
    .orderBy(asc(chatMessages.createdAt))
    .limit(limit)
    .all();
}

export async function persistMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  meta?: unknown,
): Promise<void> {
  const now = new Date().toISOString();
  await db.insert(chatMessages).values({
    id: uid(),
    conversationId,
    role,
    content,
    meta: meta ? JSON.stringify(meta) : null,
    createdAt: now,
  });
  await db
    .update(chatConversations)
    .set({ updatedAt: now })
    .where(eq(chatConversations.id, conversationId))
    .run();
}

/** Build the grounded context snapshot the AI reasons over. */
export async function buildChatContext(userId: string): Promise<ChatContext> {
  const data = await getAppData(userId);
  const profile = await getProfileBundle(userId);

  const now = new Date();
  const hour = now.getHours();
  const nowLabel = `${now.toLocaleDateString("en-US", { weekday: "long" })} ${
    hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night"
  }`;

  // subjects with progress, weakness & exam info
  const subjects = data.subjects.map((s) => {
    const exam = data.exams.find((e) => e.subjectId === s.id) ?? null;
    return {
      id: s.id,
      name: s.name,
      progress: s.progress,
      weakTopics: s.weakTopics.map((w) => w.name),
      examName: exam?.examName ?? s.exam?.name ?? null,
      examDaysLeft: exam?.daysLeft ?? s.exam?.daysLeft ?? null,
      examReadiness: exam?.readiness ?? null,
    };
  });

  const weakTopics: ChatTopicInfo[] = [];
  const notStartedNearExam: ChatTopicInfo[] = [];
  const syllabusTopics: ChatTopicInfo[] = [];
  for (const s of data.subjects) {
    for (const u of s.units) {
      for (const t of u.topics) {
        const info: ChatTopicInfo = {
          id: t.id,
          name: t.name,
          subjectId: s.id,
          subjectName: s.name,
          status: t.status,
          difficulty: t.difficulty,
          description: t.description,
        };
        syllabusTopics.push(info);
        if (t.status === "needs_revision") weakTopics.push(info);
        const exam = data.exams.find((e) => e.subjectId === s.id);
        if (t.status === "not_started" && exam && exam.daysLeft <= 21) notStartedNearExam.push(info);
      }
    }
  }

  const todayBlocks =
    data.today?.items.filter((i) => i.status === "pending" && i.kind !== "break" && i.startMinutes >= 0) ?? [];
  const todayRemainingBlocks = todayBlocks.map((b) => ({
    subject: b.subjectName ?? "General",
    topic: b.topicName ?? b.title,
    minutes: b.durationMinutes,
    at: minutesToClock(b.startMinutes),
  }));

  const examsAgg = data.exams.map((e) => ({
    id: e.id,
    name: e.examName,
    subject: e.subjectName,
    date: e.examDate,
    daysLeft: e.daysLeft,
    syllabusPercent: e.syllabusPercent,
    readiness: e.readiness,
  }));

  const upcomingDeadlines = data.tasks
    .filter((t) => t.deadline && t.status !== "completed" && t.status !== "skipped")
    .map((t) => ({ title: t.title, kind: t.kind, daysLeft: daysUntil(t.deadline!), subject: t.subjectName }))
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 6);

  // recent-week session minutes + missed block count for stats responses
  const weekAgo = new Date(Date.now() - 6 * 86400000).toISOString();
  const [{ total: weekMin }] = await db
    .select({ total: sql<number>`coalesce(sum(${studySessions.durationMinutes}),0)` })
    .from(studySessions)
    .where(and(eq(studySessions.userId, userId), eq(studySessions.completed, true), gte(studySessions.startedAt, weekAgo)))
    .all();

  const [{ c: missedCount }] = await db
    .select({ c: count() })
    .from(planItems)
    .where(and(eq(planItems.userId, userId), eq(planItems.status, "missed"), gte(planItems.date, weekAgo.slice(0, 10))))
    .all();

  void exams;
  void tasks;

  // Uploaded study materials — the model prefers these over its own
  // knowledge when they cover the question (grounded answers).
  const materialRows = await db
    .select({
      fileName: materialsTable.fileName,
      subjectName: subjectsTable.name,
      topicName: topicsTable.name,
      excerpt: materialsTable.excerpt,
    })
    .from(materialsTable)
    .leftJoin(subjectsTable, eq(materialsTable.subjectId, subjectsTable.id))
    .leftJoin(topicsTable, eq(materialsTable.topicId, topicsTable.id))
    .where(eq(materialsTable.userId, userId))
    .orderBy(desc(materialsTable.createdAt))
    .limit(30)
    .all();
  const materialCtx = materialRows.map((m) => ({
    fileName: m.fileName,
    subjectName: m.subjectName ?? "General",
    topicName: m.topicName ?? null,
    excerpt: (m.excerpt ?? "").slice(0, 900),
  }));

  // The student's own study aids — flashcards + mind maps Pilot can
  // reference by name. Capped excerpts, owned data only.
  const cardRows = await db
    .select({
      front: flashcardsTable.front,
      back: flashcardsTable.back,
      subjectName: subjectsTable.name,
    })
    .from(flashcardsTable)
    .leftJoin(subjectsTable, eq(flashcardsTable.subjectId, subjectsTable.id))
    .where(eq(flashcardsTable.userId, userId))
    .orderBy(desc(flashcardsTable.createdAt))
    .limit(15)
    .all();
  const mapRows = await db
    .select({ mapJson: mindmapsTable.mapJson })
    .from(mindmapsTable)
    .where(eq(mindmapsTable.userId, userId))
    .orderBy(desc(mindmapsTable.createdAt))
    .limit(5)
    .all();
  const studyAids = {
    flashcards: cardRows.map((c) => ({
      front: c.front.slice(0, 200),
      back: c.back.slice(0, 300),
      subjectName: c.subjectName ?? null,
    })),
    mindmaps: mapRows.flatMap((r) => {
      try {
        const parsed = JSON.parse(r.mapJson) as {
          central?: string;
          branches?: { label?: string; children?: { label?: string }[] }[];
        };
        if (!parsed.central || !Array.isArray(parsed.branches)) return [];
        return [
          {
            title: String(parsed.central).slice(0, 80),
            branches: parsed.branches.slice(0, 6).map((b) => ({
              label: String(b.label ?? "").slice(0, 60),
              children: (b.children ?? []).slice(0, 5).map((k) => String(k.label ?? "").slice(0, 60)),
            })),
          },
        ];
      } catch {
        return [];
      }
    }),
  };

  return {
    user: { name: data.user.name },
    availability: {
      weekdayHours: profile?.weekdayHours ?? 3,
      weekendHours: profile?.weekendHours ?? 5,
      preferredTimes: profile?.preferredTimes ?? [],
      sessionStyle: profile?.sessionStyle ?? "mixed",
    },
    nowLabel,
    streak: data.streak,
    thisWeekMinutes: Number(weekMin ?? 0),
    todayPlanned: data.today?.plannedMinutes ?? 0,
    todayCompletedMinutes: data.today?.completedMinutes ?? 0,
    todayRemainingBlocks,
    subjects,
    weakTopics,
    notStartedNearExam,
    syllabusTopics: syllabusTopics.slice(0, 200),
    materials: materialCtx,
    studyAids,
    exams: examsAgg,
    upcomingDeadlines,
    missedThisWeek: missedCount ?? 0,
  };
}

/** The student's study aids as model context — referenceable, never dumped whole. */
export { buildStudyAids } from "@/lib/study/study-aids";

export async function chatHistoryForView(conversationId: string) {  const rows = await recentMessages(conversationId, 60);
  return rows.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    meta: m.meta ? safeParse(m.meta) : null,
    createdAt: m.createdAt,
  }));
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
