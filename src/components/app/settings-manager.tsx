"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Brain, CalendarClock, KeyRound, MessageSquareHeart, Save, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toaster";
import {
  saveAvailabilityAction,
  savePreferencesAction,
  saveProfileAction,
} from "@/lib/actions/settings";
import type { AppUserProfile } from "@/lib/services/types";
import { FeedbackCard } from "./feedback-form";
import { VoiceSelector } from "@/components/app/voice-selector";

const TIMES = [
  { key: "morning", label: "Morning (8–12)" },
  { key: "afternoon", label: "Afternoon (12–5)" },
  { key: "evening", label: "Evening (5–9)" },
  { key: "night", label: "Night (9–late)" },
] as const;

const STYLES = [
  { key: "short", label: "Short sessions", desc: "30-min sprints, easy to fit anywhere" },
  { key: "pomodoro", label: "Pomodoro", desc: "25 min focus + 5 min break cycles" },
  { key: "deep", label: "Deep work", desc: "60–90 min blocks for hard topics" },
  { key: "mixed", label: "Mixed", desc: "Adaptive — whatever fits the topic" },
] as const;

type TimeKey = (typeof TIMES)[number]["key"];
type StyleKey = (typeof STYLES)[number]["key"];

const NOTIFICATION_OPTIONS: { key: string; label: string; desc: string }[] = [
  { key: "session", label: "Study sessions", desc: "Upcoming planned blocks" },
  { key: "missed_task", label: "Missed blocks", desc: "When a planned block is missed" },
  { key: "deadline", label: "Deadlines", desc: "Tasks approaching their due date" },
  { key: "exam", label: "Exams", desc: "Countdown warnings" },
  { key: "daily_plan", label: "Daily plan", desc: "Today's plan summary" },
  { key: "streak", label: "Streak", desc: "Streak milestones and warnings" },
  { key: "ai_recommendation", label: "Pilot insights", desc: "Adaptive recommendations" },
  { key: "achievement", label: "Achievements", desc: "New unlocks" },
];

export function SettingsManager({
  profile,
  aiStatus,
}: {
  profile: AppUserProfile;
  aiStatus: { provider: string; configured: boolean; model: string };
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);

  // local form states
  const [edu, setEdu] = React.useState(profile.educationLevel ?? "");
  const [course, setCourse] = React.useState(profile.course ?? "");
  const [year, setYear] = React.useState(profile.yearOfStudy ?? "");
  const [goals, setGoals] = React.useState(profile.studyGoals ?? "");

  const [weekday, setWeekday] = React.useState(profile.weekdayHours);
  const [weekend, setWeekend] = React.useState(profile.weekendHours);
  const [times, setTimes] = React.useState<TimeKey[]>(profile.preferredTimes as TimeKey[]);
  const [style, setStyle] = React.useState<StyleKey>((profile.sessionStyle as StyleKey) || "mixed");

  const [goalMin, setGoalMin] = React.useState(profile.dailyGoalMinutes);
  const [focusMin, setFocusMin] = React.useState(profile.focusMinutes);
  const [breakMin, setBreakMin] = React.useState(profile.breakMinutes);
  const [notifs, setNotifs] = React.useState<Record<string, boolean>>({
    session: true,
    missed_task: true,
    deadline: true,
    exam: true,
    daily_plan: true,
    streak: true,
    ai_recommendation: true,
    achievement: true,
    ...profile.notificationPrefs,
  });

  const save = async (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) => {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (res.ok) {
      toast("success", msg);
      router.refresh();
    } else {
      toast("error", "Could not save", res.error);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {/* Academic profile */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserRound className="h-4 w-4 text-muted-foreground" /> Academic profile
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <Field label="Name">
            <Input value={profile.name} disabled />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Education level">
              <Select value={edu} onChange={(e) => setEdu(e.target.value)}>
                <option value="">Select…</option>
                <option value="high-school">High school</option>
                <option value="undergraduate">Undergraduate</option>
                <option value="postgraduate">Postgraduate</option>
                <option value="self-study">Self-study / other</option>
              </Select>
            </Field>
            <Field label="Year">
              <Select value={year} onChange={(e) => setYear(e.target.value)}>
                <option value="">Select…</option>
                {["Year 1", "Year 2", "Year 3", "Year 4", "Other"].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Course / degree">
            <Input value={course} onChange={(e) => setCourse(e.target.value)} placeholder="e.g. B.Tech Computer Science" />
          </Field>
          <Field label="Study goals">
            <Textarea value={goals} onChange={(e) => setGoals(e.target.value)} placeholder="What do you want to achieve this term?" />
          </Field>
          <div className="flex justify-end">
            <Button loading={busy} onClick={() => save(() => saveProfileAction({ educationLevel: edu, course, yearOfStudy: year, studyGoals: goals }), "Profile saved")}>
              <Save className="h-4 w-4" /> Save profile
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* Availability */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-muted-foreground" /> Availability & planning
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Weekday hours" hint="Per day">
              <Input type="number" min={0.5} max={12} step={0.5} value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} />
            </Field>
            <Field label="Weekend hours" hint="Per day">
              <Input type="number" min={0.5} max={12} step={0.5} value={weekend} onChange={(e) => setWeekend(Number(e.target.value))} />
            </Field>
          </div>
          <Field label="Preferred study times">
            <div className="flex flex-wrap gap-2">
              {TIMES.map((t) => {
                const on = times.includes(t.key);
                return (
                  <button
                    key={t.key}
                    onClick={() => setTimes(on ? times.filter((x) => x !== t.key) : [...times, t.key])}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                      on ? "bg-primary-soft/80 text-primary shadow-inset-sm ring-1 ring-inset ring-primary/30" : "bg-card text-muted-foreground shadow-raise-sm hover:text-foreground"
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label="Session style">
            <div className="grid grid-cols-2 gap-2">
              {STYLES.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setStyle(s.key)}
                  className={`rounded-xl p-3 text-left transition-all cursor-pointer ${
                    style === s.key ? "bg-primary-soft/70 shadow-inset-sm ring-1 ring-inset ring-primary/25" : "bg-card shadow-raise-sm hover:shadow-raise"
                  }`}
                >
                  <p className="text-[13px] font-semibold">{s.label}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{s.desc}</p>
                </button>
              ))}
            </div>
          </Field>
          <div className="flex justify-end">
            <Button
              loading={busy}
              onClick={() =>
                save(
                  () => saveAvailabilityAction({ weekdayHours: weekday, weekendHours: weekend, preferredTimes: times, sessionStyle: style }),
                  "Availability saved — plan regenerated",
                )
              }
            >
              <Save className="h-4 w-4" /> Save & regenerate plan
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* Preferences */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">Appearance & goals</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <VoiceSelector />
          <div className="grid grid-cols-3 gap-3">
            <Field label="Daily goal (min)">
              <Input type="number" min={30} max={720} step={15} value={goalMin} onChange={(e) => setGoalMin(Number(e.target.value))} />
            </Field>
            <Field label="Focus (min)">
              <Input type="number" min={5} max={120} value={focusMin} onChange={(e) => setFocusMin(Number(e.target.value))} />
            </Field>
            <Field label="Break (min)">
              <Input type="number" min={0} max={30} value={breakMin} onChange={(e) => setBreakMin(Number(e.target.value))} />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button
              loading={busy}
              onClick={() =>
                save(
                  () =>
                    savePreferencesAction({
                      theme: "system",
                      dailyGoalMinutes: goalMin,
                      focusMinutes: focusMin,
                      breakMinutes: breakMin,
                      notificationPrefs: notifs,
                    }),
                  "Preferences saved",
                )
              }
            >
              <Save className="h-4 w-4" /> Save preferences
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">Notifications</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          {NOTIFICATION_OPTIONS.map((n) => (
            <div key={n.key} className="flex items-center justify-between gap-3 rounded-xl bg-muted/40 px-3.5 py-2.5">
              <div>
                <p className="text-[13px] font-semibold">{n.label}</p>
                <p className="text-[11px] text-muted-foreground">{n.desc}</p>
              </div>
              <Switch checked={Boolean(notifs[n.key])} onCheckedChange={(v) => setNotifs({ ...notifs, [n.key]: v })} label={n.label} />
            </div>
          ))}
        </CardBody>
      </Card>

      {/* Feedback */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquareHeart className="h-4 w-4 text-muted-foreground" /> Feedback
          </CardTitle>
        </CardHeader>
        <CardBody>
          <FeedbackCard />
        </CardBody>
      </Card>

      {/* AI provider */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-muted-foreground" /> AI provider
          </CardTitle>
        </CardHeader>
        <CardBody>
          <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-muted/40 p-4 shadow-inset-sm">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <KeyRound className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                {aiStatus.configured ? `${aiStatus.provider} · ${aiStatus.model}` : "Built-in engine mode"}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {aiStatus.configured
                  ? "The AI tutor, free-form chat and LLM quiz/flashcard generation are active. All model output is validated against JSON schemas."
                  : "Planning, rescheduling, stats and structured chat run on the deterministic StudyPilot engine — no key needed. For Render, set AI_PRIORITY plus OPENROUTER_API_KEY/OPENROUTER_MODEL, GROK_API_KEY/GROK_MODEL, and/or GEMINI_API_KEY/GEMINI_MODEL in the service Environment Variables to unlock the AI tutor and free-form chat. Legacy AI_PROVIDER, AI_API_KEY, AI_BASE_URL, and AI_MODEL remain as fallback-only settings."}
              </p>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}