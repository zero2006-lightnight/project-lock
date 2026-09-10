export type AchievementDef = {
  code: string;
  title: string;
  description: string;
  icon: string; // lucide icon name
  category: "streak" | "tasks" | "study" | "subject" | "focus" | "consistency" | "milestone";
  target: number;
  tier: number;
};

export const ACHIEVEMENT_DEFS: AchievementDef[] = [
  // Streaks
  { code: "streak_3", title: "Warming Up", description: "Keep a 3-day study streak", icon: "Flame", category: "streak", target: 3, tier: 1 },
  { code: "streak_7", title: "On Fire", description: "Keep a 7-day study streak", icon: "Flame", category: "streak", target: 7, tier: 2 },
  { code: "streak_14", title: "Unstoppable", description: "Keep a 14-day study streak", icon: "Flame", category: "streak", target: 14, tier: 3 },
  { code: "streak_30", title: "Iron Focus", description: "Keep a 30-day study streak", icon: "Trophy", category: "streak", target: 30, tier: 4 },
  // Tasks
  { code: "tasks_10", title: "Getting Things Done", description: "Complete 10 tasks", icon: "CheckCircle2", category: "tasks", target: 10, tier: 1 },
  { code: "tasks_50", title: "Task Master", description: "Complete 50 tasks", icon: "Target", category: "tasks", target: 50, tier: 2 },
  { code: "tasks_100", title: "Century Club", description: "Complete 100 tasks", icon: "Trophy", category: "tasks", target: 100, tier: 3 },
  // Study volume
  { code: "hours_5", title: "First Steps", description: "Study 5 hours in total", icon: "Timer", category: "study", target: 300, tier: 1 },
  { code: "hours_25", title: "Deep Diver", description: "Study 25 hours in total", icon: "Timer", category: "study", target: 1500, tier: 2 },
  { code: "hours_100", title: "Century of Focus", description: "Study 100 hours in total", icon: "Sparkles", category: "study", target: 6000, tier: 3 },
  { code: "hours_500", title: "Academic Marathoner", description: "Study 500 hours in total", icon: "Crown", category: "study", target: 30000, tier: 4 },
  // Subjects
  { code: "subject_first", title: "First Down", description: "Finish your first subject syllabus", icon: "BookCheck", category: "subject", target: 1, tier: 2 },
  { code: "subject_all", title: "Syllabus Slayer", description: "Complete every syllabus", icon: "Trophy", category: "subject", target: 1, tier: 3 },
  // Focus
  { code: "focus_10", title: "Flow State", description: "Complete 10 focus sessions", icon: "Zap", category: "focus", target: 10, tier: 1 },
  { code: "focus_50", title: "Focus Machine", description: "Complete 50 focus sessions", icon: "Zap", category: "focus", target: 50, tier: 2 },
  { code: "pomodoro_25", title: "Pomodoro Pro", description: "Run 25 pomodoro sessions", icon: "Clock", category: "focus", target: 25, tier: 2 },
  // Consistency
  { code: "perfect_week", title: "Perfect Week", description: "Meet your goal every day for a week", icon: "CalendarCheck", category: "consistency", target: 7, tier: 2 },
  { code: "early_bird", title: "Early Bird", description: "Complete a study session before 8 AM", icon: "Sunrise", category: "consistency", target: 1, tier: 1 },
  { code: "night_owl", title: "Night Owl", description: "Complete a study session after 10 PM", icon: "Moon", category: "consistency", target: 1, tier: 1 },
  // Milestones
  { code: "plan_complete", title: "First Plan Done", description: "Complete an entire day's plan", icon: "PartyPopper", category: "milestone", target: 1, tier: 1 },
  { code: "exam_ready", title: "Exam Ready", description: "Reach 80% readiness on an exam", icon: "GraduationCap", category: "milestone", target: 1, tier: 3 },
];

/** subject_all is special-cased in the refresh logic (unlocked when all subjects are complete). */
export function isSubjectCompletion(code: string) {
  return code === "subject_all";
}

export function achievementDefByCode(code: string) {
  return ACHIEVEMENT_DEFS.find((a) => a.code === code);
}
