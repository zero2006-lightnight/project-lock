"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { newRequestId, parseVoiceIntent, type VoiceIntent } from "@/lib/voice/intent";
import { summarizeForSpeech } from "@/lib/voice/speech";
import { executeVoiceAction } from "@/lib/voice/actions";
import type { AgentAction, TaskKind } from "@/lib/voice/action-types";

/* ──────────────────────────────────────────────────────────────
   G-o1 voice provider — optional interface layer over Pilot.

   OFF by default; no microphone/recognition objects exist until the
   user enables it. When enabled it reuses ONLY existing systems:
   Next router for navigation and POST /api/chat (Pilot) for answers.
   It never touches existing component state, so UI and voice can
   run side by side without collisions.
   ────────────────────────────────────────────────────────────── */

export type Go1Status =
  | "off" | "idle" | "listening" | "processing"
  | "thinking" | "acting" | "responding" | "error";

export type VoiceChoice = "female" | "male";

type Go1ContextValue = {
  status: Go1Status;
  supported: boolean;
  enabled: boolean;
  muted: boolean;
  voice: VoiceChoice;
  liveTranscript: string;
  lastHeard: string;
  lastAnswer: string;
  lastSpoken: string;
  notice: string | null;
  /** A voice question waiting for Pilot's chat to ask (consumed once). */
  pendingQuestion: string | null;
  enable: () => Promise<void>;
  disable: () => void;
  toggleMute: () => void;
  setVoice: (v: VoiceChoice) => void;
  stopSpeaking: () => void;
  takePendingQuestion: () => string | null;
  /** Called by Pilot's chat when the voice-asked reply arrives. */
  reportAnswer: (text: string) => void;
};

const Go1Ctx = React.createContext<Go1ContextValue | null>(null);
export function useGo1(): Go1ContextValue {
  const v = React.useContext(Go1Ctx);
  if (!v) throw new Error("useGo1 must be used inside Go1Provider");
  return v;
}
/** Safe outside the provider (e.g. future surfaces) — returns null. */
export function useGo1Optional(): Go1ContextValue | null {
  return React.useContext(Go1Ctx);
}

const GREET_KEY = "go1.greeted";
const VOICE_KEY = "go1.voice";
const MUTE_KEY = "go1.muted";

function pickVoice(choice: VoiceChoice): SpeechSynthesisVoice | null {
  try {
    const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en"));
    if (!voices.length) return null;
    const name = (v: SpeechSynthesisVoice) => v.name.toLowerCase();
    const femaleHints = ["female", "zira", "samantha", "aria", "jenny", "sonia", "libby"];
    const maleHints = ["male", "david", "daniel", "guy", "ryan", "george"];
    const hints = choice === "female" ? femaleHints : maleHints;
    return voices.find((v) => hints.some((h) => name(v).includes(h))) ?? voices[0] ?? null;
  } catch {
    return null;
  }
}

type Rec = {
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: unknown) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
} | null;

export function Go1Provider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = React.useState<Go1Status>("off");
  const [liveTranscript, setLiveTranscript] = React.useState("");
  const [lastHeard, setLastHeard] = React.useState("");
  const [lastAnswer, setLastAnswer] = React.useState("");
  const [lastSpoken, setLastSpoken] = React.useState("");
  const [notice, setNotice] = React.useState<string | null>(null);
  const [muted, setMuted] = React.useState(false);
  const [voice, setVoiceState] = React.useState<VoiceChoice>("female");

  const recRef = React.useRef<Rec>(null);
  const micStreamRef = React.useRef<MediaStream | null>(null);
  const enabledRef = React.useRef(false);
  const busyRef = React.useRef(false);
  const statusRef = React.useRef<Go1Status>("off");
  const lastFinalRef = React.useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const pendingConfirmRef = React.useRef<string | null>(null);
  const pathRef = React.useRef(pathname);
  pathRef.current = pathname;

  const supported = React.useMemo(() => {
    if (typeof window === "undefined") return false;
    const w = window as unknown as Record<string, unknown>;
    return typeof w.SpeechRecognition === "function" || typeof w.webkitSpeechRecognition === "function";
  }, []);

  const setBoth = (s: Go1Status) => {
    statusRef.current = s;
    setStatus(s);
  };

  // ── speech output ──
  // Recognition pauses while G-o1 talks: no mic echo, no CPU churn,
  // no self-triggering. It resumes when the utterance ends.
  const restartRec = React.useCallback(() => {
    if (!enabledRef.current) return;
    try {
      (recRef.current as unknown as { start?: () => void } | null)?.start?.();
    } catch {
      /* already running — onend will fire naturally */
    }
  }, []);

  const speak = React.useCallback(
    (text: string) => {
      const clean = text.trim();
      if (!clean) return;
      setLastSpoken(clean);
      try {
        if (localStorage.getItem(MUTE_KEY) === "1") return;
        if (!("speechSynthesis" in window)) return;
        try {
          (recRef.current as unknown as { stop?: () => void } | null)?.stop?.();
        } catch {
          /* recognition may already be stopped */
        }
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(clean);
        const v = pickVoice((localStorage.getItem(VOICE_KEY) as VoiceChoice) || "female");
        if (v) u.voice = v;
        u.rate = 1;
        u.volume = 1;
        setBoth("responding");
        const resume = () => {
          if (enabledRef.current && !busyRef.current) {
            setBoth("idle");
            restartRec();
          }
        };
        u.onend = resume;
        u.onerror = resume;
        window.speechSynthesis.speak(u);
      } catch {
        /* voice output failure → text remains visible; app continues */
      }
    },
    [restartRec],
  );

  const stopSpeaking = React.useCallback(() => {
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* noop */
    }
  }, []);

  // ── Pilot handoff ──
  // Info requests are asked INSIDE Pilot's chat (single request, single
  // visible conversation): the provider stages a pending question,
  // navigates to /app/chat, and the chat auto-types + sends it as the
  // user. The reply comes back via reportAnswer → spoken summary.
  const [pendingQuestion, setPendingQuestion] = React.useState<string | null>(null);
  const pendingRef = React.useRef<{ text: string; at: number } | null>(null);

  const takePendingQuestion = React.useCallback((): string | null => {
    const p = pendingRef.current;
    pendingRef.current = null;
    setPendingQuestion(null);
    if (!p || Date.now() - p.at > 60_000) return null;
    return p.text;
  }, []);

  const reportAnswer = React.useCallback(
    (text: string) => {
      const clean = text.trim();
      if (!clean || !enabledRef.current) return;
      setLastAnswer(clean);
      speak(summarizeForSpeech(clean));
    },
    [speak],
  );

  // ── intent execution ──
  const execute = React.useCallback(
    async (intent: VoiceIntent, transcript: string) => {
      switch (intent.kind) {
        case "task": {
          setBoth("acting");
          const taskAction: AgentAction = intent.action === "create"
            ? {
                type: "create_task",
              title: intent.details.replace(/^\s*(create|add|make)\s+(a\s+)?/i, "").replace(/\s+\b(task|assignment|todo|project|lab|quiz)\b.*$/i, "").trim() || transcript,
                kind: /\bquiz\b/i.test(intent.details) ? "quiz" : /\bproject\b/i.test(intent.details) ? "project" : /\blab\b/i.test(intent.details) ? "lab" : "assignment" as TaskKind,
                deadline: intent.date ?? null,
                priority: (intent.priority ?? 2) as 1 | 2 | 3,
                estimatedMinutes: Math.max(5, Math.min(600, intent.duration ?? 60)),
                notes: /\bat\s+\d{1,2}(?::\d{2})?\s*(am|pm)?\b/i.test(intent.details) ? intent.details.match(/\bat\s+(.+)$/i)?.[1] ?? null : null,
              }
            : { type: "complete_task", title: intent.details };
          const result = await executeVoiceAction(taskAction);
          speak(result.ok ? result.message : result.error);
          break;
        }
        case "planning": {
          setBoth("acting");
          const action: AgentAction = intent.action === "regenerate"
            ? { type: "regenerate_plan" }
            : intent.action === "reschedule"
              ? { type: "reschedule_missed" }
              : { type: "skip_plan", title: intent.details };
          const result = await executeVoiceAction(action);
          speak(result.ok ? result.message : result.error);
          break;
        }
        case "notification": {
          setBoth("acting");
          const result = await executeVoiceAction({ type: "mark_notifications_read" });
          speak(result.ok ? result.message : result.error);
          break;
        }
        case "navigation": {
          setBoth("acting");
          const route = intent.route === "/app/focus" && /\b(start|begin|launch)\b/i.test(transcript)
            ? "/app/focus?autostart=1"
            : intent.route;
          router.push(route);
          speak(`${intent.label} opened.`);
          break;
        }
        case "info": {
          // Hand to Pilot's chat: it types + sends as the user, so the
          // explanation lives in the chat AND is spoken aloud.
          setBoth("acting");
          pendingRef.current = { text: intent.question, at: Date.now() };
          setPendingQuestion(intent.question);
          if (pathRef.current !== "/app/chat") router.push("/app/chat");
          speak("Opening Pilot — I'll ask that for you.");
          break;
        }
        case "generation": {
          setBoth("acting");
          router.push(intent.route);
          const what = intent.target === "quiz" ? "quiz studio" : intent.target === "flashcards" ? "flashcard studio" : "mind map studio";
          const detail = [
            intent.unit ? `Unit ${intent.unit}` : null,
            intent.difficulty ? `${intent.difficulty} difficulty` : null,
          ]
            .filter(Boolean)
            .join(", ");
          speak(detail ? `${what} opened for ${detail}. Review and tap generate.` : `${what} opened. Choose your topic and tap generate.`);
          break;
        }
        case "control": {
          if (intent.action === "stop") {
            stopSpeaking();
            pendingConfirmRef.current = null;
            setBoth("idle");
          } else if (intent.action === "repeat") {
            const again = lastSpokenRef.current || lastAnswerRef.current;
            if (again) speak(again);
            else speak("There's nothing to repeat yet.");
          } else if (intent.action === "mute") {
            try {
              localStorage.setItem(MUTE_KEY, "1");
            } catch { /* noop */ }
            setMuted(true);
            stopSpeaking();
            setBoth("idle");
          } else if (intent.action === "unmute") {
            try {
              localStorage.removeItem(MUTE_KEY);
            } catch { /* noop */ }
            setMuted(false);
            speak("Voice output is back on.");
          } else {
            speak("You can ask me to explain a topic, open any section, or prepare a quiz, flashcards, or a mind map.");
          }
          break;
        }
        case "confirm": {
          const pending = pendingConfirmRef.current;
          pendingConfirmRef.current = null;
          if (pending) {
            if (intent.value) speak("For safety, deletions happen in the app itself. I've opened the relevant section for you.");
            else speak("Cancelled. Nothing was changed.");
            setBoth("idle");
          } else {
            speak("There's nothing waiting for confirmation.");
          }
          break;
        }
        case "destructive": {
          pendingConfirmRef.current = transcript;
          speak("That would change or remove your data, so I won't do it by voice. Say it was a mistake to dismiss, or do it in the app where you can review it first.");
          setBoth("idle");
          break;
        }
        case "ambiguous": {
          speak(intent.prompt);
          setBoth("idle");
          break;
        }
        case "unknown":
        default: {
          speak("I didn't catch that. Try asking about a topic or saying open syllabus.");
          setBoth("idle");
          break;
        }
      }
      busyRef.current = false;
      if (enabledRef.current && statusRef.current !== "responding") setBoth("idle");
    },
    [router, speak, stopSpeaking],
  );

  const lastSpokenRef = React.useRef("");
  const lastAnswerRef = React.useRef("");
  React.useEffect(() => {
    lastSpokenRef.current = lastSpoken;
  }, [lastSpoken]);
  React.useEffect(() => {
    lastAnswerRef.current = lastAnswer;
  }, [lastAnswer]);

  const handleFinal = React.useCallback(
    (transcript: string) => {
      const text = transcript.trim();
      if (!text || busyRef.current || !enabledRef.current) return;
      // Duplicate-event guard: identical finals within 3s execute once.
      const now = Date.now();
      if (lastFinalRef.current.text === text && now - lastFinalRef.current.at < 3000) return;
      lastFinalRef.current = { text, at: now };
      void newRequestId(); // unique lifecycle per request (idempotent execution)
      busyRef.current = true;
      setBoth("processing");
      setLastHeard(text);
      setLiveTranscript("");
      const intent = parseVoiceIntent(text, { pathname: pathRef.current });
      void execute(intent, text);
    },
    [execute],
  );

  // ── recognition lifecycle ──
  const startRecognition = React.useCallback(() => {
    try {
      const w = window as unknown as Record<string, unknown>;
      const Ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as new () => {
        new (): unknown;
        continuous: boolean;
        interimResults: boolean;
        lang: string;
        start(): void;
        stop(): void;
        abort(): void;
        onresult: ((e: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string; confidence: number } }> ; resultIndex: number }) => void) | null;
        onerror: ((e: { error: string }) => void) | null;
        onend: (() => void) | null;
      };
      const rec = new Ctor() as unknown as {
        continuous: boolean; interimResults: boolean; lang: string;
        start(): void; stop(): void; abort(): void;
        onresult: ((e: { results: { length: number; [i: number]: { isFinal: boolean; [j: number]: { transcript: string } } }; resultIndex: number }) => void) | null;
        onerror: ((e: { error: string }) => void) | null;
        onend: (() => void) | null;
      };
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "en-US";
      rec.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          const alt = r[0]?.transcript ?? "";
          if (r.isFinal) handleFinal(alt);
          else interim += alt;
        }
        if (interim) setLiveTranscript(interim);
      };
      rec.onerror = (e) => {
        if (!enabledRef.current) return;
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          setBoth("error");
          setNotice("Microphone blocked — allow access in the browser, then enable G-o1 again.");
          void disableRef.current();
        } else if (e.error === "audio-capture") {
          setBoth("error");
          setNotice("No microphone found — connect one, or keep using the app normally.");
        }
        // network/aborted/no-speech: onend restart covers recovery
      };
      rec.onend = () => {
        // Chrome auto-stops after silence — resume while enabled and idle.
        // Never while responding: recognition stays paused during speech
        // output (the utterance's own onend resumes it) to avoid mic echo.
        if (
          enabledRef.current &&
          !busyRef.current &&
          statusRef.current !== "error" &&
          statusRef.current !== "responding"
        ) {
          try {
            rec.start();
          } catch {
            /* already running */
          }
        }
      };
      recRef.current = rec as unknown as Rec;
      rec.start();
      setBoth("listening");
    } catch {
      setBoth("error");
      setNotice("Voice recognition isn't available in this browser — the app works normally without it.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleFinal]);

  const enable = React.useCallback(async () => {
    if (enabledRef.current) return;
    setNotice(null);
    enabledRef.current = true;
    setBoth("idle");
    try {
      // Permission first (explicit user gesture only — never on load).
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      stream.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    } catch {
      enabledRef.current = false;
      setBoth("error");
      setNotice("Microphone access was denied — enable it in the browser to use G-o1, or keep using the app normally.");
      return;
    }
    // Warm up the TTS voice list now — browsers load voices
    // asynchronously, and a cold first speak() is the main audio lag.
    try {
      if ("speechSynthesis" in window) {
        window.speechSynthesis.getVoices();
        const warm = () => window.speechSynthesis.getVoices();
        window.speechSynthesis.onvoiceschanged = warm;
      }
    } catch {
      /* voice warmup is best-effort */
    }
    const greeted = (() => {
      try {
        return sessionStorage.getItem(GREET_KEY) === "1";
      } catch {
        return true;
      }
    })();
    startRecognition();
    if (!greeted) {
      try {
        sessionStorage.setItem(GREET_KEY, "1");
      } catch { /* noop */ }
      speak("Hello! G-o-1 is ready. What would you like to work on today?");
    }
  }, [speak, startRecognition]);

  const disableRef = React.useRef(() => {});
  const disable = React.useCallback(() => {
    enabledRef.current = false;
    busyRef.current = false;
    pendingConfirmRef.current = null;
    pendingRef.current = null;
    setPendingQuestion(null);
    try {
      recRef.current?.abort();
    } catch { /* noop */ }
    recRef.current = null;
    try {
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
    } catch { /* noop */ }
    micStreamRef.current = null;
    stopSpeaking();
    setLiveTranscript("");
    setBoth("off");
  }, [stopSpeaking]);
  React.useEffect(() => {
    disableRef.current = disable;
  }, [disable]);

  const toggleMute = React.useCallback(() => {
    setMuted((m) => {
      const next = !m;
      try {
        if (next) localStorage.setItem(MUTE_KEY, "1");
        else localStorage.removeItem(MUTE_KEY);
      } catch { /* noop */ }
      if (next) stopSpeaking();
      return next;
    });
  }, [stopSpeaking]);

  const setVoice = React.useCallback((v: VoiceChoice) => {
    setVoiceState(v);
    try {
      localStorage.setItem(VOICE_KEY, v);
    } catch { /* noop */ }
  }, []);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.ctrlKey && event.shiftKey && event.code === "Space") {
        event.preventDefault();
        if (enabledRef.current) disable();
        else void enable();
        return;
      }
      if (event.code === "Space" && enabledRef.current && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const target = event.target as HTMLElement | null;
        if (target?.matches("input, textarea, select, button")) return;
        event.preventDefault();
        restartRec();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space" && enabledRef.current) {
        try { recRef.current?.stop(); } catch { /* recognition may already be idle */ }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [disable, enable, restartRec]);

  // Restore persisted prefs (device-scoped); always start OFF.
  React.useEffect(() => {
    try {
      const v = localStorage.getItem(VOICE_KEY);
      if (v === "male" || v === "female") setVoiceState(v);
      if (localStorage.getItem(MUTE_KEY) === "1") setMuted(true);
      if ("speechSynthesis" in window) window.speechSynthesis.getVoices();
    } catch { /* noop */ }
    return () => {
      enabledRef.current = false;
      try {
        recRef.current?.abort();
      } catch { /* noop */ }
    };
  }, []);

  const value: Go1ContextValue = {
    status, supported, enabled: status !== "off",
    muted, voice, liveTranscript, lastHeard, lastAnswer, lastSpoken, notice,
    pendingQuestion,
    enable, disable, toggleMute, setVoice, stopSpeaking,
    takePendingQuestion, reportAnswer,
  };
  return <Go1Ctx.Provider value={value}>{children}</Go1Ctx.Provider>;
}
