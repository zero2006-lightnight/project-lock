import type {
  ExamReadiness,
} from "@/lib/engine/roadmap";
import type {
  ExamPhase,
} from "@/lib/engine/roadmap";

export type TopicAgg = {
  id: string;
  name: string;
  unitId: string;
  unitName: string;
  description: string | null;
  difficulty: number;
  weight: number;
  status: "not_started" | "learning" | "completed" | "needs_revision";
  sortOrder: number;
};

export type UnitAgg = {
  id: string;
  name: string;
  sortOrder: number;
  topics: TopicAgg[];
};

export type SubjectAgg = {
  id: string;
  name: string;
  color: string;
  priority: number;
  difficulty: number;
  progress: number; // 0..100 (weighted)
  totalTopics: number;
  completedTopics: number;
  /** Remaining study hours for unfinished topics (difficulty-weighted). */
  estimatedHours: number;
  units: UnitAgg[];
  weakTopics: { id: string; name: string; difficulty: number }[];
  exam: { id: string; name: string; date: string; daysLeft: number } | null;
};

export type ExamAgg = ExamReadiness & {
  id: string;
  subjectName: string | null;
  subjectColor: string | null;
  phases: ExamPhase[];
};

export type TaskAgg = {
  id: string;
  title: string;
  kind: string;
  deadline: string | null;
  daysLeft: number | null;
  priority: number;
  estimatedMinutes: number;
  status: string;
  notes: string | null;
  subjectId: string | null;
  subjectName: string | null;
  subjectColor: string | null;
};

export type PlanItemAgg = {
  id: string;
  date: string;
  kind: string;
  title: string;
  startMinutes: number;
  durationMinutes: number;
  status: "pending" | "completed" | "skipped" | "missed";
  reason: string | null;
  origin: string;
  subjectId: string | null;
  subjectName: string | null;
  subjectColor: string | null;
  topicId: string | null;
  topicName: string | null;
  topicStatus: string | null;
  completedAt: string | null;
};

export type PlanDayAgg = {
  date: string;
  items: PlanItemAgg[];
  plannedMinutes: number;
  completedMinutes: number;
};

export type AchievementState = {
  code: string;
  title: string;
  description: string;
  icon: string;
  category: string;
  target: number;
  progress: number;
  unlocked: boolean;
  unlockedAt: string | null;
};

export type AppUserProfile = {
  id: string;
  name: string;
  email: string;
  onboarded: boolean;
  educationLevel: string | null;
  course: string | null;
  yearOfStudy: string | null;
  studyGoals: string | null;
  weekdayHours: number;
  weekendHours: number;
  preferredTimes: string[];
  sessionStyle: string;
  theme: string;
  dailyGoalMinutes: number;
  focusMinutes: number;
  breakMinutes: number;
  notificationPrefs: Record<string, boolean>;
};

export type AppData = {
  user: AppUserProfile;
  subjects: SubjectAgg[];
  exams: ExamAgg[];
  tasks: TaskAgg[];
  plan: PlanDayAgg[];
  today: PlanDayAgg | null;
  streak: number;
  longestStreak: number;
  achievements: AchievementState[];
  unlockedCount: number;
  unreadNotifications: { id: string; type: string; title: string; body: string | null; createdAt: string }[];
};

export type { ExamPhase };
