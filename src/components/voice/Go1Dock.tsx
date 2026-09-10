"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Mic, MicOff, Volume2, VolumeX, X, AudioLines } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGo1, type Go1Status } from "./Go1Provider";
import { listItem, modalBackdrop, modalPanel } from "@/components/motion/variants";

const STATUS_LABEL: Record<Go1Status, string> = {
  off: "G-o1 is off",
  idle: "G-o1 is ready",
  listening: "G-o1 is listening…",
  processing: "G-o1 heard you — understanding…",
  thinking: "G-o1 is thinking…",
  acting: "G-o1 is acting…",
  responding: "G-o1 is responding…",
  error: "G-o1 needs attention",
};

/** Talking wave — animates while G-o1 speaks, idles otherwise. */
export function Go1Wave({ live, soft, label }: { live: boolean; soft?: boolean; label: string }) {
  return (
    <span className={cn("go1-wave", live && "live", soft && "soft")} role="img" aria-label={label} aria-hidden={false}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} aria-hidden />
      ))}
    </span>
  );
}

export function Go1Dock() {
  const go1 = useGo1();
  const [open, setOpen] = React.useState(false);
  const { status, enabled } = go1;

  // Auto-open the panel on first enable so state is visible; user can close it.
  React.useEffect(() => {
    if (enabled) setOpen(true);
  }, [enabled]);

  const toggle = async () => {
    if (enabled) {
      go1.disable();
      setOpen(false);
    } else {
      await go1.enable();
    }
  };

  return (
    <>
      {/* Floating control — clear of the mobile bottom dock */}
      <div className="fixed bottom-24 right-4 z-40 lg:bottom-6 lg:right-6">
        <button
          type="button"
          onClick={toggle}
          aria-pressed={enabled}
          aria-label={enabled ? "Disable G-o1 voice assistant" : "Enable G-o1 voice assistant"}
          title={enabled ? "Disable G-o1" : "Enable G-o1"}
          className={cn(
            "brutal-press flex h-13 w-13 items-center justify-center rounded-full border-2 border-ink shadow-brutal",
            enabled ? "bg-lime text-inkfill" : "bg-card text-muted-foreground hover:text-foreground",
          )}
        >
          {enabled ? <AudioLines className="h-5 w-5" aria-hidden /> : <Mic className="h-5 w-5" aria-hidden />}
        </button>
        {enabled && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label="Toggle G-o1 panel"
            className="brutal-press mt-2 flex h-10 w-13 items-center justify-center rounded-full border-2 border-ink bg-card text-xs font-bold shadow-brutal-sm"
          >
            {status === "responding" ? (
              <Go1Wave live label="G-o1 is speaking" />
            ) : status === "listening" ? (
              <Go1Wave live soft label="G-o1 is listening" />
            ) : (
              "G-o1"
            )}
          </button>
        )}
      </div>

      <AnimatePresence>
        {open && enabled && (
          <>
            <motion.div variants={modalBackdrop} initial="hidden" animate="show" exit="exit" className="fixed inset-0 z-40 bg-black/40 lg:bg-transparent lg:pointer-events-none" onClick={() => setOpen(false)} aria-hidden />
            <motion.div
              variants={modalPanel}
              initial="hidden"
              animate="show"
              exit="exit"
              role="dialog"
              aria-label="G-o1 voice assistant"
              className="fixed bottom-40 right-4 z-50 w-[calc(100vw-2rem)] max-w-sm rounded-[6px] border-2 border-ink bg-card text-card-foreground shadow-brutal-lg lg:bottom-24 lg:right-6"
            >
              <div className="flex items-center justify-between gap-2 border-b-2 border-ink px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className={cn("h-2.5 w-2.5 rounded-full", status === "listening" ? "animate-pulse bg-danger" : status === "error" ? "bg-danger" : status === "off" ? "bg-muted-foreground" : "bg-success")} aria-hidden />
                  <p className="text-sm font-bold" role="status" aria-live="polite">{STATUS_LABEL[status]}</p>
                  {status === "responding" && <Go1Wave live label="G-o1 is speaking" />}
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={go1.toggleMute} aria-label={go1.muted ? "Unmute voice output" : "Mute voice output"} aria-pressed={go1.muted} className="cursor-pointer rounded-[6px] border-2 border-ink bg-card p-1.5 shadow-brutal-sm brutal-press">
                    {go1.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                  </button>
                  <button type="button" onClick={go1.stopSpeaking} aria-label="Stop speaking" className="cursor-pointer rounded-[6px] border-2 border-ink bg-card p-1.5 shadow-brutal-sm brutal-press">
                    <MicOff className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => setOpen(false)} aria-label="Close G-o1 panel" className="cursor-pointer rounded-[6px] border-2 border-ink bg-card p-1.5 shadow-brutal-sm brutal-press">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="max-h-80 space-y-3 overflow-y-auto px-4 py-3">
                {!go1.supported && (
                  <p className="text-xs text-muted-foreground" role="alert">
                    This browser doesn't support speech recognition — type in Pilot instead. Everything else works normally.
                  </p>
                )}
                {go1.notice && (
                  <motion.p variants={listItem} initial="hidden" animate="show" className="rounded-[6px] border-2 border-ink bg-warning-soft px-3 py-2 text-xs font-medium" role="alert">
                    {go1.notice}
                  </motion.p>
                )}
                {(go1.liveTranscript || go1.lastHeard) && (
                  <div>
                    <p className="eyebrow text-muted-foreground">You said</p>
                    <p className="mt-1 text-[13px] leading-relaxed">“{go1.liveTranscript || go1.lastHeard}”</p>
                  </div>
                )}
                {go1.lastAnswer && (
                  <div>
                    <p className="eyebrow text-muted-foreground">G-o1 answered</p>
                    <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-line text-[13px] leading-relaxed">{go1.lastAnswer}</p>
                  </div>
                )}
                {!go1.lastHeard && !go1.lastAnswer && (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Try “open my syllabus”, “explain photosynthesis”, or “prepare a medium quiz”. Tap the mic button anytime to turn me off.
                  </p>
                )}

                <fieldset className="rounded-[6px] border-2 border-ink bg-muted/30 px-3 py-2">
                  <legend className="px-1 text-[11px] font-bold uppercase tracking-wide">Voice</legend>
                  <div className="flex items-center gap-3" role="radiogroup" aria-label="Voice choice">
                    {(["female", "male"] as const).map((v) => (
                      <label key={v} className="flex cursor-pointer items-center gap-1.5 text-[13px] font-medium">
                        <input
                          type="radio"
                          name="go1-voice"
                          checked={go1.voice === v}
                          onChange={() => go1.setVoice(v)}
                          className="h-4 w-4 accent-current"
                        />
                        {v === "female" ? "Female" : "Male"}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>

              <div className="flex items-center justify-end gap-2 border-t-2 border-ink px-4 py-3">
                <button
                  type="button"
                  onClick={() => {
                    go1.disable();
                    setOpen(false);
                  }}
                  className="brutal-press cursor-pointer rounded-[6px] border-2 border-ink bg-danger-fill px-4 py-2 text-[13px] font-bold text-inkfill shadow-brutal-sm"
                >
                  Disable G-o1
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
