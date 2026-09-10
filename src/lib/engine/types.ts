export type EngineSubject = {
  id: string;
  name: string;
  /** 1..3 subject priority */
  priority: number;
  /** 1..3 subject difficulty */
  difficulty: number;
};

export type EngineTopic = {
  id: string;
  subjectId: string;
  unitId: string;
  name: string;
  /** 1..5 */
  difficulty: number;
  weight: number;
  status: "not_started" | "learning" | "completed" | "needs_revision";
  /** unit + topic ordering, used for prerequisite-ish stability */
  unitOrder: number;
  topicOrder: number;
  lastStudiedAt: string | null;
};

export type EngineExam = {
  id: string;
  subjectId: string | null;
  name: string;
  /** ISO yyyy-MM-dd */
  date: string;
  importance: number;
};

export type EngineTask = {
  id: string;
  subjectId: string | null;
  title: string;
  deadline: string | null;
  status: string;
  estimatedMinutes: number;
};

export type EngineAvailability = {
  weekdayHours: number;
  weekendHours: number;
  /** preferred buckets: morning | afternoon | evening | night */
  preferredTimes: string[];
  /** learning-style driven chunk length: short | pomodoro | deep | mixed */
  sessionStyle: string;
};

export type EnginePlanBlock = {
  date: string;
  startMinutes: number;
  durationMinutes: number;
  kind: "study" | "revision" | "review" | "break";
  subjectId: string | null;
  subjectName: string | null;
  subjectColor: string | null;
  topicId: string | null;
  topicName: string | null;
  /** if this block is assignment work, topicId is null and title carries the task title */
  title: string | null;
  reason: string;
  origin: "planned" | "rescheduled";
};

export type EngineDayPlan = {
  date: string;
  totalMinutes: number;
  blocks: EnginePlanBlock[];
};

export type ScheduleInput = {
  subjects: EngineSubject[];
  topics: EngineTopic[];
  exams: EngineExam[];
  tasks: EngineTask[];
  availability: EngineAvailability;
  /** number of days to plan ahead (default 7) */
  horizonDays?: number;
  /** start planning from this date (default today) */
  fromDate?: string;
  /** plan items that were missed recently — their topics get redistributed first */
  missed?: { topicId: string | null; date: string; minutes: number; title: string; subjectId: string | null }[];
  /** subjectId + color + name for task blocks */
  subjectMeta: Record<string, { id: string; name: string; color: string }>;
};

export type ScheduleResult = {
  days: EngineDayPlan[];
  /** topicId -> minutes remaining after the horizon (not schedulable in time) */
  overflow: { topicId: string; name: string; minutes: number; subjectId: string }[];
  coveragePercent: number;
};
