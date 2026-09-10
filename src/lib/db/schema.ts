import { sql } from "drizzle-orm";
import {
  blob,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/* ──────────────────────────────────────────────────────────────
   Shared helpers
   ────────────────────────────────────────────────────────────── */
const id = (name: string) => text(name).notNull();
const timestamps = {
  createdAt: text("created_at")
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
};

export const now = () => new Date().toISOString();

/* ──────────────────────────────────────────────────────────────
   Users & profile
   ────────────────────────────────────────────────────────────── */
export const users = sqliteTable(
  "users",
  {
    id: id("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash"),
    image: text("image"),
    onboarded: integer("onboarded", { mode: "boolean" }).notNull().default(false),
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)],
);

export const profiles = sqliteTable(
  "profiles",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    educationLevel: text("education_level"),
    course: text("course"),
    yearOfStudy: text("year_of_study"),
    studyGoals: text("study_goals"),
    weekdayHours: real("weekday_hours").notNull().default(3),
    weekendHours: real("weekend_hours").notNull().default(5),
    /** JSON: array of "morning" | "afternoon" | "evening" | "night" */
    preferredTimes: text("preferred_times").notNull().default("[]"),
    /** session style preference: short | pomodoro | deep | mixed */
    sessionStyle: text("session_style").notNull().default("mixed"),
    updatedAt: timestamps.updatedAt,
  },
  (t) => [primaryKey({ columns: [t.userId] })],
);

export const settings = sqliteTable(
  "settings",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** light | dark | system */
    theme: text("theme").notNull().default("system"),
    dailyGoalMinutes: integer("daily_goal_minutes").notNull().default(240),
    /** JSON object of notification toggles */
    notificationPrefs: text("notification_prefs").notNull().default("{}"),
    focusMinutes: integer("focus_minutes").notNull().default(25),
    breakMinutes: integer("break_minutes").notNull().default(5),
    updatedAt: timestamps.updatedAt,
  },
  (t) => [primaryKey({ columns: [t.userId] })],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: id("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_token_idx").on(t.tokenHash)],
);

/* ──────────────────────────────────────────────────────────────
   Academics
   ────────────────────────────────────────────────────────────── */
export const subjects = sqliteTable(
  "subjects",
  {
    id: id("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("#5753d4"),
    /** 1 = low, 2 = medium, 3 = high */
    priority: integer("priority").notNull().default(2),
    difficulty: integer("difficulty").notNull().default(2),
    sortOrder: integer("sort_order").notNull().default(0),
    deletedAt: text("deleted_at"),
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
  },
  (t) => [index("subjects_user_idx").on(t.userId)],
);

export const units = sqliteTable(
  "units",
  {
    id: id("id").primaryKey(),
    subjectId: text("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("units_subject_idx").on(t.subjectId)],
);

export const topicStatuses = ["not_started", "learning", "completed", "needs_revision"] as const;
export type TopicStatus = (typeof topicStatuses)[number];

export const topics = sqliteTable(
  "topics",
  {
    id: id("id").primaryKey(),
    unitId: text("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    /** 1..5 difficulty */
    difficulty: integer("difficulty").notNull().default(3),
    /** relative syllabus weight used by the planner (default 1) */
    weight: real("weight").notNull().default(1),
    status: text("status", { enum: topicStatuses }).notNull().default("not_started"),
    sortOrder: integer("sort_order").notNull().default(0),
    completedAt: text("completed_at"),
    lastStudiedAt: text("last_studied_at"),
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
  },
  (t) => [index("topics_unit_idx").on(t.unitId), index("topics_status_idx").on(t.status)],
);

export const examImportances = [1, 2, 3] as const;

export const exams = sqliteTable(
  "exams",
  {
    id: id("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subjectId: text("subject_id").references(() => subjects.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    /** ISO date yyyy-MM-dd */
    date: text("date").notNull(),
    /** 1..3 importance */
    importance: integer("importance").notNull().default(2),
    targetScore: integer("target_score"),
    notes: text("notes"),
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
  },
  (t) => [
    index("exams_user_idx").on(t.userId),
    index("exams_subject_idx").on(t.subjectId),
    index("exams_date_idx").on(t.date),
  ],
);

export const taskKinds = ["assignment", "project", "lab", "quiz", "revision", "other"] as const;
export type TaskKind = (typeof taskKinds)[number];
export const taskStatuses = ["todo", "in_progress", "completed", "skipped"] as const;
export type TaskStatus = (typeof taskStatuses)[number];

export const tasks = sqliteTable(
  "tasks",
  {
    id: id("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subjectId: text("subject_id").references(() => subjects.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    kind: text("kind", { enum: taskKinds }).notNull().default("assignment"),
    /** ISO date or null when open-ended */
    deadline: text("deadline"),
    priority: integer("priority").notNull().default(2),
    estimatedMinutes: integer("estimated_minutes").notNull().default(60),
    status: text("status", { enum: taskStatuses }).notNull().default("todo"),
    notes: text("notes"),
    completedAt: text("completed_at"),
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
  },
  (t) => [
    index("tasks_user_idx").on(t.userId),
    index("tasks_deadline_idx").on(t.deadline),
    index("tasks_status_idx").on(t.status),
  ],
);

/* ──────────────────────────────────────────────────────────────
   Planning
   ────────────────────────────────────────────────────────────── */
export const planItemKinds = ["study", "break", "revision", "review", "focus"] as const;
export type PlanItemKind = (typeof planItemKinds)[number];
export const planItemStatuses = ["pending", "completed", "skipped", "missed"] as const;
export type PlanItemStatus = (typeof planItemStatuses)[number];

export const planItems = sqliteTable(
  "plan_items",
  {
    id: id("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    kind: text("kind", { enum: planItemKinds }).notNull().default("study"),
    subjectId: text("subject_id").references(() => subjects.id, { onDelete: "set null" }),
    topicId: text("topic_id").references(() => topics.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    /** minutes from midnight for start */
    startMinutes: integer("start_minutes").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    status: text("status", { enum: planItemStatuses }).notNull().default("pending"),
    /** short label explaining why the block exists, e.g. "Exam in 11 days" */
    reason: text("reason"),
    /** planned | rescheduled | manual */
    origin: text("origin").notNull().default("planned"),
    completedAt: text("completed_at"),
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
  },
  (t) => [
    index("plan_user_date_idx").on(t.userId, t.date),
    index("plan_subject_idx").on(t.subjectId),
    index("plan_topic_idx").on(t.topicId),
  ],
);

/* ──────────────────────────────────────────────────────────────
   Activity
   ────────────────────────────────────────────────────────────── */
export const sessionKinds = ["focus", "manual", "quick"] as const;
export type SessionKind = (typeof sessionKinds)[number];

export const studySessions = sqliteTable(
  "study_sessions",
  {
    id: id("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subjectId: text("subject_id").references(() => subjects.id, { onDelete: "set null" }),
    topicId: text("topic_id").references(() => topics.id, { onDelete: "set null" }),
    planItemId: text("plan_item_id").references(() => planItems.id, { onDelete: "set null" }),
    kind: text("kind", { enum: sessionKinds }).notNull().default("focus"),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at"),
    durationMinutes: integer("duration_minutes").notNull().default(0),
    completed: integer("completed", { mode: "boolean" }).notNull().default(false),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index("study_sessions_user_idx").on(t.userId),
    index("study_sessions_subject_idx").on(t.subjectId),
    index("study_sessions_started_idx").on(t.startedAt),
  ],
);

/* ──────────────────────────────────────────────────────────────
   AI & learning tools
   ────────────────────────────────────────────────────────────── */
export const chatConversations = sqliteTable(
  "chat_conversations",
  {
    id: id("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New conversation"),
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
    /** When set, this conversation is a wrapped-up (past) session. */
    endedAt: text("ended_at"),
  },
  (t) => [index("chat_conv_user_idx").on(t.userId)],
);

export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: id("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => chatConversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // user | assistant
    content: text("content").notNull(),
    /** JSON: structured payload for AI messages (intent, recommendations, blocks...) */
    meta: text("meta"),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("chat_msg_conv_idx").on(t.conversationId)],
);

export const flashcards = sqliteTable(
  "flashcards",
  {
    id: id("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subjectId: text("subject_id").references(() => subjects.id, { onDelete: "set null" }),
    topicId: text("topic_id").references(() => topics.id, { onDelete: "set null" }),
    front: text("front").notNull(),
    back: text("back").notNull(),
    source: text("source").notNull().default("manual"), // manual | ai
    /** spaced-repetition state */
    ease: real("ease").notNull().default(2.5),
    intervalDays: integer("interval_days").notNull().default(0),
    reviewCount: integer("review_count").notNull().default(0),
    dueAt: text("due_at"),
    lastReviewedAt: text("last_reviewed_at"),
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
  },
  (t) => [
    index("fc_user_idx").on(t.userId),
    index("fc_due_idx").on(t.userId, t.dueAt),
  ],
);

/* ────────────────────────────────────────────────────────────
   Study mind maps — Pilot-generated, structured (JSON), saved per
   user so Pilot can reference them later in chat.
   ──────────────────────────────────────────────────────────── */
export const mindmaps = sqliteTable(
  "mindmaps",
  {
    id: id("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subjectId: text("subject_id").references(() => subjects.id, { onDelete: "set null" }),
    /** Central topic title (also the display name). */
    title: text("title").notNull(),
    /** The original request: syllabus scope or general prompt (capped). */
    prompt: text("prompt").notNull().default(""),
    /** syllabus | general */
    source: text("source").notNull().default("syllabus"),
    /** Validated MindMap JSON: { central, summary, branches[] }. */
    mapJson: text("map_json").notNull().default("{}"),
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
  },
  (t) => [index("mindmaps_user_idx").on(t.userId)],
);

/* ────────────────────────────────────────────────────────────
   Study materials (uploaded files, extracted text)
   ──────────────────────────────────────────────────────────── */
export const materialKinds = ["pdf", "image", "word", "excel", "text"] as const;
export type MaterialKind = (typeof materialKinds)[number];

export const materials = sqliteTable(
  "materials",
  {
    id: id("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subjectId: text("subject_id").references(() => subjects.id, { onDelete: "set null" }),
    topicId: text("topic_id").references(() => topics.id, { onDelete: "set null" }),
    fileName: text("file_name").notNull(),
    kind: text("kind", { enum: materialKinds }).notNull(),
    /** Original MIME type — stored so uploaded images can be served back. */
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes").notNull().default(0),
    /** Image bytes — images are retrievable at /api/material/[id]. */
    rawBlob: blob("raw_blob", { mode: "buffer" }),
    /** Extracted plain text used for AI grounding (null while processing/failed). */
    excerpt: text("excerpt"),
    /** Full extracted text (may be long); excerpt is the truncated view. */
    fullText: text("full_text"),
    charCount: integer("char_count").notNull().default(0),
    status: text("status").notNull().default("ready"), // ready | failed
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index("materials_user_idx").on(t.userId),
    index("materials_subject_idx").on(t.subjectId),
  ],
);

export const quizAttempts = sqliteTable(
  "quiz_attempts",
  {
    id: id("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subjectId: text("subject_id").references(() => subjects.id, { onDelete: "set null" }),
    source: text("source").notNull().default("ai"), // ai | flashcards | manual
    questionCount: integer("question_count").notNull().default(0),
    correctCount: integer("correct_count").notNull().default(0),
    durationSeconds: integer("duration_seconds"),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("quiz_user_idx").on(t.userId)],
);

/* ──────────────────────────────────────────────────────────────
   Tuning — subject knowledge bases (RAG, not model training)
   ────────────────────────────────────────────────────────────── */
export const kbStatuses = ["empty", "processing", "ready", "partial"] as const;
export type KbStatus = (typeof kbStatuses)[number];

export const knowledgeBases = sqliteTable(
  "knowledge_bases",
  {
    id: id("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Optional link to a curriculum subject; null = standalone tuned space. */
    subjectId: text("subject_id").references(() => subjects.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    status: text("status", { enum: kbStatuses }).notNull().default("empty"),
    docCount: integer("doc_count").notNull().default(0),
    readyDocCount: integer("ready_doc_count").notNull().default(0),
    conceptCount: integer("concept_count").notNull().default(0),
    /** JSON: { coreConcepts[], definitions[], relationships[], topicTree, questionPatterns[], terminologyNotes[], summary } */
    profileJson: text("profile_json").notNull().default("{}"),
    /** "local" | "provider" — which embedding source built the index. */
    embeddingSource: text("embedding_source").notNull().default("local"),
    lastProcessedAt: text("last_processed_at"),
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
  },
  (t) => [
    index("kb_user_idx").on(t.userId),
    index("kb_subject_idx").on(t.subjectId),
  ],
);

export const tuningDocStatuses = [
  "uploaded",
  "queued",
  "reading",
  "chunking",
  "indexing",
  "patterns",
  "ready",
  "failed",
] as const;
export type TuningDocStatus = (typeof tuningDocStatuses)[number];

export const knowledgeDocuments = sqliteTable(
  "knowledge_documents",
  {
    id: id("id").primaryKey(),
    kbId: text("kb_id")
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull().default("application/pdf"),
    sizeBytes: integer("size_bytes").notNull().default(0),
    charCount: integer("char_count").notNull().default(0),
    chunkCount: integer("chunk_count").notNull().default(0),
    status: text("status", { enum: tuningDocStatuses }).notNull().default("uploaded"),
    /** 0..100 — real pipeline progress, never simulated. */
    progress: integer("progress").notNull().default(0),
    error: text("error"),
    /** Raw upload bytes — consumed by the background worker, then cleared. */
    rawBlob: blob("raw_blob", { mode: "buffer" }),
    /** Extracted full text (capped); chunks + embeddings derive from this. */
    fullText: text("full_text"),
    /** Idempotency: same user + KB + name + size reuses the row. */
    dedupeKey: text("dedupe_key").notNull().default(""),
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
  },
  (t) => [
    index("kdoc_kb_idx").on(t.kbId),
    index("kdoc_user_idx").on(t.userId),
    uniqueIndex("kdoc_dedupe_unique").on(t.userId, t.kbId, t.dedupeKey),
  ],
);

export const knowledgeChunks = sqliteTable(
  "knowledge_chunks",
  {
    id: id("id").primaryKey(),
    docId: text("doc_id")
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    kbId: text("kb_id")
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subjectId: text("subject_id").references(() => subjects.id, { onDelete: "set null" }),
    ord: integer("ord").notNull().default(0),
    section: text("section"),
    content: text("content").notNull(),
    /** JSON array of numbers (provider or local embedding). */
    embedding: text("embedding").notNull().default("[]"),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index("kchunk_kb_idx").on(t.kbId),
    index("kchunk_doc_idx").on(t.docId),
    index("kchunk_user_idx").on(t.userId),
  ],
);

export const tuningJobStatuses = ["queued", "running", "done", "failed"] as const;
export type TuningJobStatus = (typeof tuningJobStatuses)[number];

export const tuningJobs = sqliteTable(
  "tuning_jobs",
  {
    id: id("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** process_document | rebuild_profile */
    type: text("type").notNull().default("process_document"),
    status: text("status", { enum: tuningJobStatuses }).notNull().default("queued"),
    progress: integer("progress").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    /** JSON payload, e.g. { docId } — never trusts client user IDs. */
    payloadJson: text("payload_json").notNull().default("{}"),
    /** Idempotency key: one queued/running job per key. */
    idemKey: text("idem_key").notNull().default(""),
    error: text("error"),
    nextRunAt: text("next_run_at"),
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
    completedAt: text("completed_at"),
  },
  (t) => [
    index("tjob_user_idx").on(t.userId),
    index("tjob_status_idx").on(t.status, t.nextRunAt),
    uniqueIndex("tjob_idem_unique").on(t.userId, t.idemKey),
  ],
);

/** Per-user Tuning preferences (detail level). Adjustable + resettable. */
export const tuningPrefs = sqliteTable(
  "tuning_prefs",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** short | medium | detailed */
    detailLevel: text("detail_level").notNull().default("medium"),
    /** JSON: learned preference signals { visualRequests, detailRequests, styleRequests } — counts only, staged temporary → confidence → suggested. */
    signalsJson: text("signals_json").notNull().default("{}"),
    updatedAt: timestamps.updatedAt,
  },
  (t) => [primaryKey({ columns: [t.userId] })],
);

/* ──────────────────────────────────────────────────────────────
   Tuning error lessons — Dynamic Error Learning & Mistake Prevention.

   Controlled Error Memory + retrieval + prevention layer (NOT model
   retraining). One row = one reusable prevention rule, scoped by
   userId FIRST then kbId/subject (strict isolation — never cross-user,
   never cross-subject unless explicitly shared context). Embeddings
   reuse the same local hashed-vector scheme as knowledgeChunks so no
   second vector DB is needed.
   ────────────────────────────────────────────────────────────── */
export const errorLessonTypes = [
  "factual_error",
  "context_error",
  "reasoning_error",
  "source_priority_error",
  "retrieval_error",
  "format_error",
  "parsing_error",
  "user_preference_error",
  "tool_failure",
  "workflow_error",
] as const;
export type ErrorLessonType = (typeof errorLessonTypes)[number];

export const errorLessonConfidences = ["high", "medium", "low", "unverified"] as const;
export type ErrorLessonConfidence = (typeof errorLessonConfidences)[number];

export const errorLessonStatuses = ["active", "low_priority", "under_review", "obsolete", "disabled"] as const;
export type ErrorLessonStatus = (typeof errorLessonStatuses)[number];

export const tuningErrorLessons = sqliteTable(
  "tuning_error_lessons",
  {
    id: id("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Tuning scope — KB this lesson belongs to (null = user-wide fallback, still user-scoped). */
    kbId: text("kb_id").references(() => knowledgeBases.id, { onDelete: "cascade" }),
    subjectId: text("subject_id").references(() => subjects.id, { onDelete: "set null" }),
    /** Short topic label for relevance filtering (e.g. "Unit 3 normalization"). */
    topic: text("topic"),
    errorType: text("error_type", { enum: errorLessonTypes }).notNull().default("factual_error"),
    mistakeSummary: text("mistake_summary").notNull(),
    rootCause: text("root_cause").notNull().default(""),
    correctApproach: text("correct_approach").notNull().default(""),
    /** The reusable, actionable prevention rule injected into future prompts. */
    preventionRule: text("prevention_rule").notNull(),
    /** JSON: { correctionText?, chunkExcerpts?, origin: user_correction|feedback|technical } */
    sourceEvidence: text("source_evidence").notNull().default("{}"),
    confidence: text("confidence", { enum: errorLessonConfidences }).notNull().default("unverified"),
    /** JSON: { keywords: string[] } — compact relevance metadata (no full conversations). */
    relevanceMetadata: text("relevance_metadata").notNull().default("{}"),
    /** JSON array of numbers (same local hashed-vector scheme as chunks) for fast relevance ranking. */
    embedding: text("embedding").notNull().default("[]"),
    occurrenceCount: integer("occurrence_count").notNull().default(1),
    usageCount: integer("usage_count").notNull().default(0),
    status: text("status", { enum: errorLessonStatuses }).notNull().default("active"),
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
    lastOccurredAt: text("last_occurred_at"),
    lastUsedAt: text("last_used_at"),
  },
  (t) => [
    index("errlesson_user_idx").on(t.userId),
    index("errlesson_kb_idx").on(t.kbId),
    index("errlesson_user_kb_idx").on(t.userId, t.kbId),
    index("errlesson_status_idx").on(t.status),
  ],
);

/* ──────────────────────────────────────────────────────────────
   Profile feedback (product + controlled AI/Pilot improvement)
   ────────────────────────────────────────────────────────────── */
export const feedbackCategories = [
  "ai_answer",
  "pilot",
  "tuning",
  "accuracy",
  "performance",
  "ui_ux",
  "bug",
  "feature",
  "general",
] as const;
export type FeedbackCategory = (typeof feedbackCategories)[number];

export const feedbackStatuses = ["submitted", "analyzed", "verified", "learned", "resolved"] as const;
export type FeedbackStatus = (typeof feedbackStatuses)[number];

export const feedback = sqliteTable(
  "feedback",
  {
    id: id("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: text("category", { enum: feedbackCategories }).notNull().default("general"),
    rating: integer("rating"),
    text: text("text").notNull(),
    /** JSON: { feature?, interactionRef? } — minimal context only, never full histories. */
    contextJson: text("context_json").notNull().default("{}"),
    status: text("status", { enum: feedbackStatuses }).notNull().default("submitted"),
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
  },
  (t) => [index("feedback_user_idx").on(t.userId), index("feedback_status_idx").on(t.status)],
);

export type Feedback = typeof feedback.$inferSelect;

/* ──────────────────────────────────────────────────────────────
   Learning Community Hub (private, anonymous-by-default)
   ────────────────────────────────────────────────────────────── */
export const communityRoles = ["admin", "member"] as const;
export type CommunityRole = (typeof communityRoles)[number];

export const communityStatuses = ["active", "closed"] as const;
export type CommunityStatus = (typeof communityStatuses)[number];

export const communities = sqliteTable(
  "communities",
  {
    id: id("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    subject: text("subject"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status", { enum: communityStatuses }).notNull().default("active"),
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
  },
  (t) => [index("community_creator_idx").on(t.createdBy)],
);

export type Community = typeof communities.$inferSelect;

export const communityMemberships = sqliteTable(
  "community_memberships",
  {
    id: id("id").primaryKey(),
    communityId: text("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: communityRoles }).notNull().default("member"),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    uniqueIndex("membership_unique").on(t.communityId, t.userId),
    index("membership_community_idx").on(t.communityId),
    index("membership_user_idx").on(t.userId),
  ],
);

export type CommunityMembership = typeof communityMemberships.$inferSelect;

export const communityInvites = sqliteTable(
  "community_invites",
  {
    id: id("id").primaryKey(),
    communityId: text("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    /** SHA-256 of the token — the raw token is shown once, never stored. */
    tokenHash: text("token_hash").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: text("expires_at"),
    maxUses: integer("max_uses").notNull().default(0), // 0 = unlimited
    useCount: integer("use_count").notNull().default(0),
    revokedAt: text("revoked_at"),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("invite_community_idx").on(t.communityId), uniqueIndex("invite_token_unique").on(t.tokenHash)],
);

export type CommunityInvite = typeof communityInvites.$inferSelect;

export const communityMaterials = sqliteTable(
  "community_materials",
  {
    id: id("id").primaryKey(),
    communityId: text("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    uploadedBy: text("uploaded_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull().default("application/octet-stream"),
    sizeBytes: integer("size_bytes").notNull().default(0),
    rawBlob: blob("raw_blob", { mode: "buffer" }),
    status: text("status").notNull().default("active"), // active | removed
    createdAt: timestamps.createdAt,
  },
  (t) => [index("cmat_community_idx").on(t.communityId)],
);

export type CommunityMaterial = typeof communityMaterials.$inferSelect;

export const communityQuestionStatuses = ["open", "answered", "resolved"] as const;
export type CommunityQuestionStatus = (typeof communityQuestionStatuses)[number];

export const communityQuestions = sqliteTable(
  "community_questions",
  {
    id: id("id").primaryKey(),
    communityId: text("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: text("content").notNull().default(""),
    subject: text("subject"),
    status: text("status", { enum: communityQuestionStatuses }).notNull().default("open"),
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
  },
  (t) => [index("cquestion_community_idx").on(t.communityId)],
);

export type CommunityQuestion = typeof communityQuestions.$inferSelect;

export const communityAnswers = sqliteTable(
  "community_answers",
  {
    id: id("id").primaryKey(),
    questionId: text("question_id")
      .notNull()
      .references(() => communityQuestions.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    helpful: integer("helpful", { mode: "boolean" }).notNull().default(false),
    status: text("status").notNull().default("active"), // active | removed
    createdAt: timestamps.createdAt,
  },
  (t) => [index("canswer_question_idx").on(t.questionId)],
);

export type CommunityAnswer = typeof communityAnswers.$inferSelect;

/* ──────────────────────────────────────────────────────────────
   Motivation & notifications
   ────────────────────────────────────────────────────────────── */
export const achievements = sqliteTable(
  "achievements",
  {
    id: id("id").primaryKey(),
    code: text("code").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    icon: text("icon").notNull(),
    category: text("category").notNull().default("general"), // streak | tasks | study | subject | exam | focus
    target: integer("target").notNull().default(1),
    tier: integer("tier").notNull().default(1),
  },
  (t) => [uniqueIndex("achievements_code_unique").on(t.code)],
);

export const userAchievements = sqliteTable(
  "user_achievements",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    achievementId: text("achievement_id")
      .notNull()
      .references(() => achievements.id, { onDelete: "cascade" }),
    progress: integer("progress").notNull().default(0),
    unlockedAt: text("unlocked_at"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.achievementId] })],
);

export const notificationTypes = [
  "session",
  "missed_task",
  "deadline",
  "exam",
  "daily_plan",
  "streak",
  "ai_recommendation",
  "achievement",
] as const;
export type NotificationType = (typeof notificationTypes)[number];

export const notifications = sqliteTable(
  "notifications",
  {
    id: id("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type", { enum: notificationTypes }).notNull(),
    title: text("title").notNull(),
    body: text("body"),
    read: integer("read", { mode: "boolean" }).notNull().default(false),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("notif_user_idx").on(t.userId), index("notif_read_idx").on(t.userId, t.read)],
);

export const aiRecommendations = sqliteTable(
  "ai_recommendations",
  {
    id: id("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // e.g. dashboard | insight | planning | exam
    message: text("message").notNull(),
    meta: text("meta"),
    seen: integer("seen", { mode: "boolean" }).notNull().default(false),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("rec_user_idx").on(t.userId), index("rec_seen_idx").on(t.userId, t.seen)],
);

/* ──────────────────────────────────────────────────────────────
   Types
   ────────────────────────────────────────────────────────────── */
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Profile = typeof profiles.$inferSelect;
export type Settings = typeof settings.$inferSelect;
export type Subject = typeof subjects.$inferSelect;
export type Unit = typeof units.$inferSelect;
export type Topic = typeof topics.$inferSelect;
export type Exam = typeof exams.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type PlanItem = typeof planItems.$inferSelect;
export type StudySession = typeof studySessions.$inferSelect;
export type ChatConversation = typeof chatConversations.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type Flashcard = typeof flashcards.$inferSelect;
export type Mindmap = typeof mindmaps.$inferSelect;
export type Material = typeof materials.$inferSelect;
export type QuizAttempt = typeof quizAttempts.$inferSelect;
export type Achievement = typeof achievements.$inferSelect;
export type UserAchievement = typeof userAchievements.$inferSelect;
/* ──────────────────────────────────────────────────────────────
   Exams assessment workspace (Quiz + Summary Practice)
   ────────────────────────────────────────────────────────────── */
export const assessmentModes = ["quiz", "summary"] as const;
export type AssessmentMode = (typeof assessmentModes)[number];
export const assessmentStatuses = ["draft", "active", "graded"] as const;
export type AssessmentStatus = (typeof assessmentStatuses)[number];

/**
 * One assessment run. Quiz questions (with correct answers) live here as
 * trusted JSON — the client never decides correctness; grading reads
 * this row. Answer images are never persisted (processed in-memory).
 */
export const assessmentAttempts = sqliteTable(
  "assessment_attempts",
  {
    id: id("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subjectId: text("subject_id").references(() => subjects.id, { onDelete: "set null" }),
    mode: text("mode", { enum: assessmentModes }).notNull(),
    status: text("status", { enum: assessmentStatuses }).notNull().default("draft"),
    /** Truncated study material (capped) — the ground truth for this run. */
    materialExcerpt: text("material_excerpt").notNull().default(""),
    /** sha256 of the full material — detects swaps between calls. */
    materialHash: text("material_hash").notNull().default(""),
    /** JSON: quiz questions OR summary prompt (+config). */
    promptJson: text("prompt_json").notNull().default("{}"),
    /** JSON: submitted answers / evaluation result. */
    resultJson: text("result_json").notNull().default("{}"),
    score: integer("score"),
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
  },
  (t) => [index("assess_user_idx").on(t.userId), index("assess_mode_idx").on(t.userId, t.mode)],
);

export type Notification = typeof notifications.$inferSelect;
export type AIRecommendation = typeof aiRecommendations.$inferSelect;
export type AssessmentAttempt = typeof assessmentAttempts.$inferSelect;
export type KnowledgeBase = typeof knowledgeBases.$inferSelect;
export type KnowledgeDocument = typeof knowledgeDocuments.$inferSelect;
export type KnowledgeChunk = typeof knowledgeChunks.$inferSelect;
export type TuningJob = typeof tuningJobs.$inferSelect;
export type TuningPrefs = typeof tuningPrefs.$inferSelect;
export type TuningErrorLesson = typeof tuningErrorLessons.$inferSelect;
