"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BellRing,
  Check,
  ChevronLeft,
  Coffee,
  Expand,
  Flame,
  Headphones,
  LockKeyhole,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Timer as TimerIcon,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, Field } from "@/components/ui/input";
import { useToast } from "@/components/ui/toaster";
import { finishFocusAction } from "@/lib/actions/planning";
import type { PlanItemAgg, SubjectAgg } from "@/lib/services/types";
import { useSpeech } from "@/hooks/useSpeech";

type PickItem = {
  id: string;
  subjectId: string | null;
  subjectName: string | null;
  subjectColor: string | null;
  topicId: string | null;
  title: string;
  minutes: number;
};

type LockPhase = "idle" | "confirm" | "countdown" | "active" | "warning" | "failed" | "break" | "complete";
type NoiseKind = "rain" | "forest" | "library" | "cafe" | "brown" | "ocean" | "fireplace";

const NOISES: NoiseKind[] = ["rain", "forest", "library", "cafe", "brown", "ocean", "fireplace"];
const QUOTES = ["Keep going.", "You're building consistency.", "Every minute counts.", "One session. Zero distractions."];

export function FocusTimer({
  planItems,
  subjects,
  defaultMinutes,
  defaultBreak,
  autoStart = false,
}: {
  planItems: PlanItemAgg[];
  subjects: SubjectAgg[];
  defaultMinutes: number;
  defaultBreak: number;
  autoStart?: boolean;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const { toast } = useToast();
  const { speak } = useSpeech();

  const pickable: PickItem[] = [
    ...planItems
      .filter((p) => p.status === "pending" && p.kind !== "break")
      .map((p) => ({
        id: `plan:${p.id}`,
        subjectId: p.subjectId,
        subjectName: p.subjectName,
        subjectColor: p.subjectColor,
        topicId: p.topicId,
        title: p.topicName ?? p.title,
        minutes: p.durationMinutes,
      })),
    ...subjects.flatMap((s) =>
      s.weakTopics.slice(0, 2).map((w) => ({
        id: `topic:${w.id}`,
        subjectId: s.id,
        subjectName: s.name,
        subjectColor: s.color,
        topicId: w.id,
        title: `Revision · ${w.name}`,
        minutes: defaultMinutes,
      })),
    ),
  ];

  const initialPlanId = sp.get("planItemId");
  const initial = initialPlanId ? pickable.find((p) => p.id === `plan:${initialPlanId}`) : pickable[0];
  const [selected, setSelected] = React.useState<PickItem | undefined>(initial ?? pickable[0]);
  const [mode, setMode] = React.useState<"focus" | "break">("focus");
  const [duration, setDuration] = React.useState(initial?.minutes ?? defaultMinutes);
  const [remaining, setRemaining] = React.useState((initial?.minutes ?? defaultMinutes) * 60);
  const [running, setRunning] = React.useState(false);
  const [startedAt, setStartedAt] = React.useState(new Date().toISOString());
  const [finished, setFinished] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [unlocked, setUnlocked] = React.useState<string[]>([]);
  const [phase, setPhase] = React.useState<LockPhase>("idle");
  const [countdown, setCountdown] = React.useState(3);
  const [strikes, setStrikes] = React.useState(0);
  const [pauseCount, setPauseCount] = React.useState(0);
  const [fullscreenExits, setFullscreenExits] = React.useState(0);
  const [distractionSeconds, setDistractionSeconds] = React.useState(5);
  const [strictMode, setStrictMode] = React.useState(true);
  const [notificationsSilenced, setNotificationsSilenced] = React.useState(false);
  const [notificationSupport, setNotificationSupport] = React.useState(true);
  const [quote, setQuote] = React.useState(QUOTES[0]);
  const [noise, setNoise] = React.useState<NoiseKind | "off">("off");
  const [noiseVolume, setNoiseVolume] = React.useState(0.18);
  const [score, setScore] = React.useState(100);
  const [wakeLock, setWakeLock] = React.useState<WakeLockSentinel | null>(null);
  const alarmRef = React.useRef<AudioContext | null>(null);
  const noiseSourceRef = React.useRef<AudioBufferSourceNode | null>(null);
  const noiseGainRef = React.useRef<GainNode | null>(null);
  const alarmTimerRef = React.useRef<number | null>(null);
  const distractionTimerRef = React.useRef<number | null>(null);
  const distractionStartedRef = React.useRef<number | null>(null);
  const distractionGuardRef = React.useRef(0);
  const sessionStartedRef = React.useRef<string | null>(null);
  const phaseRef = React.useRef<LockPhase>("idle");
  const strikesRef = React.useRef(0);
  const finishSessionRef = React.useRef<((completed?: boolean) => Promise<void>) | null>(null);

  React.useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  React.useEffect(() => {
    const stored = window.localStorage.getItem("studypilot-focus-strict");
    if (stored !== null) setStrictMode(stored !== "false");
    if (autoStart) setPhase("confirm");
  }, [autoStart]);

  const playTone = React.useCallback((frequency: number, durationMs: number, loop = false) => {
    const AudioCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    const context = alarmRef.current ?? new AudioCtor();
    alarmRef.current = context;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sawtooth";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.8, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + durationMs / 1000);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + durationMs / 1000 + 0.03);
    if (loop) {
      if (alarmTimerRef.current) window.clearInterval(alarmTimerRef.current);
      alarmTimerRef.current = window.setInterval(() => playTone(frequency, durationMs), durationMs + 100);
    }
  }, []);

  const stopAlarm = React.useCallback(() => {
    if (alarmTimerRef.current) window.clearInterval(alarmTimerRef.current);
    alarmTimerRef.current = null;
  }, []);

  const requestWakeLock = React.useCallback(async () => {
    if (!("wakeLock" in navigator)) return;
    try {
      const lock = await navigator.wakeLock.request("screen");
      setWakeLock(lock);
    } catch {
      setWakeLock(null);
    }
  }, []);

  const leaveImmersiveMode = React.useCallback(() => {
    stopAlarm();
    wakeLock?.release().catch(() => undefined);
    setWakeLock(null);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
  }, [stopAlarm, wakeLock]);

  const failSession = React.useCallback(() => {
    setRunning(false);
    setPhase("failed");
    setScore((value) => Math.max(0, value - 50));
    stopAlarm();
    void finishSessionRef.current?.(false);
  }, [stopAlarm]);

  const registerDistraction = React.useCallback(() => {
    if (phaseRef.current !== "active" || mode !== "focus") return;
    if (Date.now() - distractionGuardRef.current < 1000) return;
    distractionGuardRef.current = Date.now();
    const next = strikesRef.current + 1;
    strikesRef.current = next;
    setStrikes(next);
    setScore((value) => Math.max(0, value - 15));
    setRunning(false);
    setPhase("warning");
    setDistractionSeconds(5);
    distractionStartedRef.current = Date.now();
    playTone(180, 500, true);
    navigator.vibrate?.([300, 150, 300]);
    if (next >= 3 && strictMode) failSession();
  }, [failSession, mode, playTone, strictMode]);

  React.useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") registerDistraction();
      else if (phaseRef.current === "warning") stopAlarm();
    };
    const onBlur = () => registerDistraction();
    const onFullscreen = () => {
      if (phaseRef.current === "active" && !document.fullscreenElement) {
        setFullscreenExits((value) => value + 1);
        setScore((value) => Math.max(0, value - 10));
        registerDistraction();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("pagehide", onVisibility);
    window.addEventListener("freeze", onVisibility);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pagehide", onVisibility);
      window.removeEventListener("freeze", onVisibility);
      document.removeEventListener("fullscreenchange", onFullscreen);
    };
  }, [registerDistraction, stopAlarm]);

  React.useEffect(() => {
    if (phase !== "warning") return;
    const timer = window.setInterval(() => {
      setDistractionSeconds((value) => {
        if (value <= 1) {
          window.clearInterval(timer);
          failSession();
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [failSession, phase]);

  React.useEffect(() => {
    if (phase !== "active" || !running) return;
    const timer = window.setInterval(() => setQuote(QUOTES[Math.floor(Date.now() / 600000) % QUOTES.length]!), 60000);
    return () => window.clearInterval(timer);
  }, [phase, running]);

  React.useEffect(() => {
    noiseSourceRef.current?.stop();
    noiseSourceRef.current?.disconnect();
    noiseGainRef.current?.disconnect();
    noiseSourceRef.current = null;
    noiseGainRef.current = null;
    if (noise === "off" || !["active", "break"].includes(phase)) return;
    const AudioCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    const context = alarmRef.current ?? new AudioCtor();
    alarmRef.current = context;
    const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const channel = buffer.getChannelData(0);
    let last = 0;
    for (let index = 0; index < channel.length; index += 1) {
      const random = Math.random() * 2 - 1;
      last = noise === "brown" ? (last + 0.02 * random) / 1.02 : random;
      channel[index] = noise === "brown" ? last * 3.5 : random * 0.35;
    }
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.loop = true;
    gain.gain.value = noiseVolume;
    source.connect(gain).connect(context.destination);
    source.start();
    noiseSourceRef.current = source;
    noiseGainRef.current = gain;
    return () => {
      source.stop();
      source.disconnect();
      gain.disconnect();
    };
  }, [noise, noiseVolume, phase]);

  React.useEffect(() => {
    if (phase !== "countdown") return;
    if (countdown <= 0) {
      setPhase("active");
      setRunning(true);
      const actualStart = new Date().toISOString();
      sessionStartedRef.current = actualStart;
      setStartedAt(actualStart);
      requestWakeLock();
      document.documentElement.requestFullscreen?.().catch(() => undefined);
      void speak(`Your focus session has started. Stay focused for the next ${duration} minutes.`).catch(() => undefined);
      return;
    }
    const timer = window.setTimeout(() => setCountdown((value) => value - 1), 850);
    return () => window.clearTimeout(timer);
  }, [countdown, duration, phase, requestWakeLock, speak]);

  React.useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (phaseRef.current === "active" || phaseRef.current === "warning" || phaseRef.current === "break") {
        event.preventDefault();
        event.returnValue = "Your focus session is still active.";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  React.useEffect(() => () => {
    stopAlarm();
    wakeLock?.release().catch(() => undefined);
    alarmRef.current?.close().catch(() => undefined);
  }, [stopAlarm, wakeLock]);

  React.useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(t);
          setRunning(false);
          if (mode === "focus") {
            setMode("break");
            setPhase("break");
            setRemaining(defaultBreak * 60);
            playTone(880, 700);
            void speak(`Great work. Take a ${defaultBreak}-minute break.`).catch(() => undefined);
          } else {
            setMode("focus");
            setPhase("active");
            setRemaining(duration * 60);
          }
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [defaultBreak, duration, mode, playTone, running, speak]);

  React.useEffect(() => {
    if (!finished) return;
    void speak("Focus session completed. Excellent job.").catch(() => undefined);
  }, [finished, speak]);

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  const startBreak = () => {
    setMode("break");
    setRemaining(defaultBreak * 60);
    setRunning(true);
    setPhase("break");
    stopAlarm();
    void speak(`Great work. Take a ${defaultBreak}-minute break.`).catch(() => undefined);
  };

  const startFocus = () => {
    setMode("focus");
    setCountdown(3);
    setPhase("confirm");
  };

  const beginCountdown = async () => {
    if (typeof Notification === "undefined") {
      setNotificationSupport(false);
    } else {
      try {
        if (Notification.permission === "default") await Notification.requestPermission();
        setNotificationsSilenced(Notification.permission === "granted");
      } catch {
        setNotificationSupport(false);
      }
    }
    setPhase("countdown");
  };

  const finish = async (completed = true) => {
    setBusy(true);
    const res = await finishFocusAction({
      planItemId: selected?.id.startsWith("plan:") ? selected.id.slice(5) : null,
      subjectId: selected?.subjectId ?? null,
      topicId: selected?.topicId ?? null,
      startedAt: sessionStartedRef.current ?? startedAt,
      endedAt: new Date().toISOString(),
      durationMinutes: Math.max(1, Math.round((duration * 60 - remaining) / 60)),
      completed,
    });
    setBusy(false);
    if (res.ok) {
      setUnlocked(res.unlocked ?? []);
      setScore((value) => Math.min(150, value + 20 + (strikes === 0 ? 30 : 0)));
      setPhase(completed ? "complete" : "failed");
      leaveImmersiveMode();
      toast(completed ? "success" : "info", completed ? "Session recorded" : "Session ended", `${duration} minutes of focus logged`);
      router.refresh();
    } else {
      toast("error", "Could not record session", res.error);
    }
  };
  finishSessionRef.current = finish;

  const elapsed = Math.round(((duration * 60 - remaining) / 60) * 10) / 10;

  if (["active", "warning", "failed", "break", "complete"].includes(phase)) {
    const failed = phase === "failed";
    const complete = phase === "complete";
    return (
      <div className={cn("fixed inset-0 z-[100] overflow-y-auto bg-[#050608] text-white", mode === "break" && "bg-[#10221f]")}>
        <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-60" aria-hidden>
          <div className="absolute left-1/4 top-1/4 h-80 w-80 rounded-full bg-lime/10 blur-3xl animate-pulse" />
          <div className="absolute bottom-0 right-1/4 h-96 w-96 rounded-full bg-brutal-blue/10 blur-3xl animate-pulse [animation-delay:1.5s]" />
          <div className="absolute inset-0 opacity-20 [background-image:radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] [background-size:34px_34px]" />
        </div>
        <div className="relative mx-auto flex min-h-dvh max-w-3xl flex-col items-center justify-center px-6 py-10 text-center">
          <div className="absolute left-6 right-6 top-6 flex items-center justify-between text-xs text-white/60">
            <span className="inline-flex items-center gap-2"><LockKeyhole className="h-4 w-4 text-lime" /> Ultra Focus Lock</span>
            <span className="inline-flex items-center gap-2"><Flame className="h-4 w-4 text-brutal-yellow" /> {strikes} {strikes === 1 ? "strike" : "strikes"}</span>
          </div>

          {complete ? (
            <div className="relative w-full max-w-md space-y-6">
              <div className="mx-auto flex h-28 w-28 items-center justify-center rounded-full border-8 border-lime text-lime shadow-[0_0_60px_rgba(216,243,107,0.25)]">
                <span className="text-3xl font-bold">{score}</span>
              </div>
              <div>
                <p className="text-3xl font-bold">Session complete</p>
                <p className="mt-2 text-white/65">Excellent work on {selected?.title ?? "your session"}.</p>
              </div>
              <Button onClick={() => { setPhase("idle"); setFinished(false); setRemaining(duration * 60); }} className="bg-lime text-inkfill hover:bg-lime/90">
                <ChevronLeft className="h-4 w-4" /> Return to Focus
              </Button>
            </div>
          ) : failed ? (
            <div className="relative w-full max-w-md space-y-6">
              <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full border-8 border-danger text-danger"><X className="h-10 w-10" /></div>
              <div><p className="text-3xl font-bold">Session failed</p><p className="mt-2 text-white/65">Session failed due to distractions.</p></div>
              <p className="text-sm text-white/50">{strikes} strikes · score {score}</p>
              <Button variant="outline" onClick={() => { leaveImmersiveMode(); setPhase("idle"); setRemaining(duration * 60); }}>End session</Button>
            </div>
          ) : (
            <>
              <div className="relative flex items-center justify-center">
                <svg width="300" height="300" className={cn("-rotate-90", running && "animate-breath")} aria-label={`${fmt(remaining)} remaining`} role="img">
                  <circle cx="150" cy="150" r="126" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="8" />
                  <circle cx="150" cy="150" r="126" fill="none" stroke={mode === "focus" ? "#d8f36b" : "#54c8ae"} strokeWidth="8" strokeLinecap="round" strokeDasharray={2 * Math.PI * 126} strokeDashoffset={2 * Math.PI * 126 * (1 - remaining / (duration * 60))} />
                </svg>
                <div className="absolute flex flex-col items-center">
                  <span className="text-6xl font-bold tabular-nums tracking-tight">{fmt(remaining)}</span>
                  <span className="mt-2 text-xs font-semibold uppercase tracking-[0.24em] text-white/50">{mode === "focus" ? "Deep focus" : "Break"}</span>
                </div>
              </div>
              <p className="mt-8 text-xl font-semibold">{selected?.subjectName ?? "Study session"}</p>
              <p className="mt-1 text-white/60">{selected?.title ?? "Stay with the work in front of you."}</p>
              <p className="mt-8 max-w-sm text-sm italic text-white/55">“{mode === "focus" ? quote : "Breathe. Recover. Return stronger."}”</p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-2 text-xs text-white/55">
                <span className="rounded-full border border-white/10 px-3 py-1.5"><ShieldCheck className="mr-1 inline h-3.5 w-3.5 text-lime" /> {notificationsSilenced ? "Notifications silenced" : notificationSupport ? "In-app notifications silenced" : "Browser notification control unavailable"}</span>
                <span className="rounded-full border border-white/10 px-3 py-1.5"><Flame className="mr-1 inline h-3.5 w-3.5 text-brutal-yellow" /> Score {score}</span>
              </div>
              <div className="mt-8 flex items-center gap-2">
                {mode === "focus" && !running && <Button onClick={() => { setRunning(true); requestWakeLock(); }}><Play className="h-4 w-4" /> Resume</Button>}
                {mode === "focus" && running && <Button variant="secondary" onClick={() => { setRunning(false); setPauseCount((value) => value + 1); setScore((value) => Math.max(0, value - 5)); }}><Pause className="h-4 w-4" /> Pause</Button>}
                {mode === "focus" && !running && elapsed >= 1 && <Button variant="outline" onClick={startBreak}><Coffee className="h-4 w-4" /> Break</Button>}
                {mode === "focus" && !running && elapsed >= 1 && <Button variant="success" loading={busy} onClick={() => void finish()}><Check className="h-4 w-4" /> Complete & log</Button>}
                {mode === "break" && <Button onClick={() => { setMode("focus"); setPhase("active"); setRemaining(duration * 60); setRunning(true); requestWakeLock(); }}><Play className="h-4 w-4" /> Resume focus</Button>}
                <Button variant="ghost" onClick={() => { setRunning(false); void finish(false); }}><X className="h-4 w-4" /> End</Button>
              </div>
            </>
          )}

          {phase === "warning" && (
            <div className="fixed inset-0 z-10 flex items-center justify-center bg-red-950/90 p-6">
              <div className="max-w-sm space-y-5 text-center">
                <BellRing className="mx-auto h-12 w-12 animate-pulse text-red-300" />
                <div><p className="text-3xl font-bold">Focus broken</p><p className="mt-2 text-red-100/70">Return within {distractionSeconds} seconds.</p></div>
                <Button onClick={() => { stopAlarm(); setPhase("active"); setRunning(true); requestWakeLock(); }} className="bg-white text-red-950 hover:bg-white/90">Acknowledge and resume</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      {(phase === "confirm" || phase === "countdown") && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-[#050608]/90 p-6 backdrop-blur-md">
          <div className="w-full max-w-lg space-y-6 rounded-3xl border border-white/10 bg-[#101319] p-7 text-white shadow-2xl">
            {phase === "countdown" ? (
              <div className="py-10 text-center">
                <LockKeyhole className="mx-auto h-10 w-10 text-lime" />
                <p className="mt-5 text-8xl font-bold tabular-nums text-lime animate-pulse">{countdown || "GO"}</p>
                <p className="mt-3 text-sm text-white/55">Entering Ultra Focus Lock</p>
              </div>
            ) : (
              <>
                <div><p className="text-2xl font-bold">Ready to Enter Deep Focus?</p><p className="mt-2 text-sm text-white/60">One session. Zero distractions.</p></div>
                <ul className="space-y-3 text-sm text-white/75">
                  <li>• Notifications will be silenced.</li>
                  <li>• Leaving this tab will trigger a warning.</li>
                  <li>• Repeated tab switching ends the session.</li>
                  <li>• Focus statistics will be recorded.</li>
                </ul>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setPhase("idle")}><X className="h-4 w-4" /> Cancel</Button>
                  <Button onClick={beginCountdown} className="bg-lime text-inkfill hover:bg-lime/90"><LockKeyhole className="h-4 w-4" /> Start Deep Focus</Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      <Card>
        <CardBody className="flex flex-col items-center py-8">
          {finished ? (
            <div className="flex flex-col items-center text-center">
              <span className="animate-pop mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-success-soft text-success shadow-inset-sm">
                <Check className="h-8 w-8" />
              </span>
              <p className="text-xl font-bold tracking-tight">Nice work! 🎉</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {Math.max(1, elapsed)} minute{Math.max(1, elapsed) === 1 ? "" : "s"} on {selected?.title ?? "your session"}
              </p>
              {unlocked.length > 0 && (
                <div className="mt-4 rounded-2xl bg-accent-soft px-4 py-3 text-sm font-semibold text-accent">
                  {unlocked.length === 1 ? "Achievement unlocked" : "Achievements unlocked"}: {unlocked.join(", ")}
                </div>
              )}
              <div className="mt-6 flex gap-2">
                <Button variant="outline" onClick={() => router.push("/app/today")}>
                  Back to plan
                </Button>
                <Button onClick={() => router.push("/app/progress")}>See progress</Button>
              </div>
            </div>
          ) : (
            <>
              <div className={cn("relative flex items-center justify-center", running && "animate-breath")}>
                <svg width="220" height="220" className="-rotate-90">
                  <circle cx="110" cy="110" r="92" fill="none" stroke="var(--color-muted)" strokeWidth="17" />
                  <circle
                    cx="110"
                    cy="110"
                    r="92"
                    fill="none"
                    stroke={mode === "focus" ? "var(--color-primary)" : "var(--color-success)"}
                    strokeWidth="13"
                    strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 92}
                    strokeDashoffset={2 * Math.PI * 92 * (1 - remaining / (duration * 60))}
                    style={{ transition: "stroke-dashoffset 1s linear" }}
                  />
                </svg>
                <div className="absolute flex h-[164px] w-[164px] flex-col items-center justify-center rounded-full bg-card shadow-inset-lg">
                  <span className="text-5xl font-bold tabular-nums tracking-tight">{fmt(remaining)}</span>
                  <span className="mt-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                    {mode === "focus" ? "Focus" : "Break"}
                  </span>
                </div>
              </div>

              <div className="mt-6 w-full space-y-3">
                <Field label="What are you working on?">
                  <Select
                    value={selected?.id ?? ""}
                    onChange={(e) => {
                      const pick = pickable.find((p) => p.id === e.target.value);
                      setSelected(pick);
                      if (pick && !running) {
                        setDuration(pick.minutes);
                        setRemaining(pick.minutes * 60);
                      }
                    }}
                  >
                    {pickable.length === 0 && <option value="">General focus</option>}
                    {pickable.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.subjectName ? `${p.subjectName} — ` : ""}
                        {p.title} ({p.minutes}m)
                      </option>
                    ))}
                  </Select>
                </Field>

                <div className="grid gap-3 rounded-2xl bg-muted/30 p-3 sm:grid-cols-2">
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold">
                    <input
                      type="checkbox"
                      checked={strictMode}
                      onChange={(event) => {
                        setStrictMode(event.target.checked);
                        window.localStorage.setItem("studypilot-focus-strict", String(event.target.checked));
                      }}
                      className="h-4 w-4 accent-[var(--color-primary)]"
                    />
                    <LockKeyhole className="h-3.5 w-3.5 text-primary" /> Strict Mode
                  </label>
                  <label className="flex items-center gap-2 text-xs font-semibold">
                    <Headphones className="h-3.5 w-3.5 text-primary" />
                    <select value={noise} onChange={(event) => setNoise(event.target.value as NoiseKind | "off")} className="min-w-0 flex-1 bg-transparent text-xs outline-none">
                      <option value="off">White noise off</option>
                      {NOISES.map((item) => <option key={item} value={item}>{item[0]!.toUpperCase() + item.slice(1)}</option>)}
                    </select>
                  </label>
                  {noise !== "off" && (
                    <label className="col-span-full flex items-center gap-2 text-xs text-muted-foreground">
                      <VolumeX className="h-3.5 w-3.5" />
                      <input type="range" min="0" max="1" step="0.01" value={noiseVolume} onChange={(event) => setNoiseVolume(Number(event.target.value))} className="flex-1" aria-label="White noise volume" />
                      <Volume2 className="h-3.5 w-3.5" />
                    </label>
                  )}
                </div>

                <div className="flex items-center justify-center gap-2">
                  {[25, 50, 90].map((m) => (
                    <button
                      key={m}
                      onClick={() => {
                        if (running) return;
                        setDuration(m);
                        setRemaining(m * 60);
                      }}
                      className={cn(
                        "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all cursor-pointer",
                        duration === m ? "bg-primary text-primary-foreground shadow-raise-sm" : "bg-muted/70 text-muted-foreground shadow-inset-sm hover:text-foreground",
                      )}
                    >
                      {m} min
                    </button>
                  ))}
                </div>

                <div className="flex items-center justify-center gap-2.5 pt-2">
                  {!running ? (
                    <>
                      {remaining < duration * 60 && (
                        <Button variant="ghost" onClick={() => { setRemaining(duration * 60); }}>
                          <RotateCcw className="h-4 w-4" /> Reset
                        </Button>
                      )}
                      <Button size="lg" onClick={startFocus} className="min-w-32">
                        <Play className="h-5 w-5" /> {remaining === duration * 60 ? "Start focus" : "Resume"}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button size="lg" variant="secondary" onClick={() => setRunning(false)}>
                        <Pause className="h-5 w-5" /> Pause
                      </Button>
                      <Button size="lg" variant="ghost" onClick={() => { setRunning(false); setRemaining(0); }}>
                        <X className="h-5 w-5" /> Finish early
                      </Button>
                    </>
                  )}
                </div>

                {mode === "focus" && elapsed >= 1 && (
                  <div className="flex justify-center">
                    <Button variant="outline" size="sm" onClick={startBreak}>
                      <Coffee className="h-4 w-4" /> Take a {defaultBreak}-minute break
                    </Button>
                  </div>
                )}

                {!running && elapsed >= 1 && (
                  <div className="flex justify-center">
                    <Button variant="success" size="lg" loading={busy} onClick={() => void finish()} className="min-w-40">
                      <Check className="h-5 w-5" /> Complete & log
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </CardBody>
      </Card>

      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <TimerIcon className="h-3.5 w-3.5" />
        Sessions are logged automatically and update your plan, streak and analytics.
      </div>
    </div>
  );
}