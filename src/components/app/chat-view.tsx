"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, FileText, History, LoaderCircle, MessageSquarePlus, Rocket, Sparkles, Volume2 } from "lucide-react";
import { listItem } from "@/components/motion/variants";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toaster";
import { useGo1Optional } from "@/components/voice/Go1Provider";
import {
  newChatSessionAction,
  openChatSessionAction,
  sessionMessagesAction,
} from "@/lib/actions/sessions";
import { Avatar } from "@/components/ui/avatar";
import { useSpeech } from "@/hooks/useSpeech";

type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  meta: { actions?: { label: string; href: string }[]; suggested?: string[] } | null;
};

type SessionInfo = {
  id: string;
  title: string;
  preview: string;
  updatedAt: string;
  messageCount: number;
  active: boolean;
};

const SUGGESTIONS = [
  "Plan my day",
  "What should I study now?",
  "Am I on track?",
  "What are my weak topics?",
  "Create a mind map of my weakest topic",
  "Quiz me",
  "Make flashcards from my materials",
  "What's the tallest mountain on Earth?",
];

/** Very small markdown renderer: **bold**, headings, lists, quotes. */
function Rich({ text }: { text: string }) {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        const listMatch = trimmed.match(/^(\d+\.|-|\*|•)\s+(.*)$/);
        if (trimmed.startsWith("**") && trimmed.endsWith("**") && trimmed.length > 4 && !trimmed.slice(2, -2).includes("**")) {
          return (
            <p key={i} className="pt-1 font-semibold text-foreground">
              {trimmed.slice(2, -2)}
            </p>
          );
        }
        if (listMatch) {
          return (
            <div key={i} className="flex gap-2">
              <span className="shrink-0 font-semibold text-primary">{listMatch[1] === "-" || listMatch[1] === "*" || listMatch[1] === "•" ? "•" : listMatch[1]}</span>
              <span className="min-w-0">{inlineBold(listMatch[2])}</span>
            </div>
          );
        }
        return <p key={i}>{inlineBold(trimmed)}</p>;
      })}
    </div>
  );
}

function inlineBold(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? (
      <strong key={i} className="font-semibold text-foreground">
        {p.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

export function ChatView({
  initialMessages,
  userName,
  activeConversationId,
  sessions: initialSessions,
}: {
  initialMessages: Msg[];
  userName: string;
  activeConversationId: string;
  sessions: SessionInfo[];
}) {
  const { toast } = useToast();
  const { speak, isSpeaking } = useSpeech();
  const router = useRouter();
  const [messages, setMessages] = React.useState<Msg[]>(initialMessages);
  const [sessions, setSessions] = React.useState<SessionInfo[]>(initialSessions);
  const [activeId, setActiveId] = React.useState(activeConversationId);
  const [input, setInput] = React.useState("");
  const [thinking, setThinking] = React.useState(false);
  const [streaming, setStreaming] = React.useState(false);
  const [showSessions, setShowSessions] = React.useState(false);
  // G-o1 handoff: a voice question staged by the provider is typed into
  // Pilot's own input and sent as the user — one shared conversation.
  const go1 = useGo1Optional();
  const voiceAskedRef = React.useRef(false);
  const pilotStatus = thinking && !streaming ? "Understanding your request" : streaming ? "Preparing your response" : null;
  const bottomRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  const refreshSessions = React.useCallback(() => {
    router.refresh();
  }, [router]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || thinking) return;
    setInput("");
    setMessages((m) => [...m, { id: `local-${Date.now()}`, role: "user", content: trimmed, meta: null }]);
    setThinking(true);
    setStreaming(false);
    const aiId = `ai-${Date.now()}`;
    try {
      // Streaming path: token-by-token via SSE, with the server's final
      // "done" record as the authoritative (validated + persisted) reply.
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });
      if (res.status === 429 || res.status === 400) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast("error", "Pilot couldn't respond", data?.error ?? "Please try again.");
        return;
      }
      if (res.status === 401) {
        toast("error", "Session expired", "Please sign in again.");
        router.push("/login");
        return;
      }
      if (!res.ok || !res.body) {
        throw new Error(`stream unavailable (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";
      let created = false;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const evLine = frame.split("\n").find((l) => l.startsWith("event:"));
          const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
          if (!evLine || !dataLine) continue;
          const event = evLine.slice(6).trim();
          let payload: Record<string, unknown> = {};
          try {
            payload = JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>;
          } catch {
            continue;
          }
          if (event === "delta") {
            acc += typeof payload.t === "string" ? payload.t : "";
            if (!created) {
              created = true;
              setStreaming(true);
              setMessages((m) => [...m, { id: aiId, role: "assistant", content: acc, meta: null }]);
            } else {
              setMessages((m) => m.map((x) => (x.id === aiId ? { ...x, content: acc } : x)));
            }
          } else if (event === "done") {
            const finalContent = typeof payload.reply === "string" && payload.reply ? payload.reply : acc;
            // Voice-asked question answered → hand the reply back to G-o1
            // for its spoken summary. Typed questions never trigger speech.
            if (voiceAskedRef.current) {
              voiceAskedRef.current = false;
              go1?.reportAnswer(finalContent);
            }
            const meta = {
              actions: (payload.actions as { label: string; href: string }[] | undefined) ?? [],
              suggested: (payload.suggested as string[] | undefined) ?? [],
            };
            if (!created) {
              created = true;
              setMessages((m) => [...m, { id: aiId, role: "assistant", content: finalContent, meta }]);
            } else {
              setMessages((m) => m.map((x) => (x.id === aiId ? { ...x, content: finalContent, meta } : x)));
            }
            setSessions((s) =>
              s.map((x) =>
                x.id === payload.conversationId
                  ? { ...x, title: x.title === "New session" ? trimmed.slice(0, 48) : x.title, preview: trimmed.slice(0, 80), messageCount: x.messageCount + 2 }
                  : x,
              ),
            );
          } else if (event === "error") {
            toast("error", "Pilot couldn't respond", typeof payload.message === "string" ? payload.message : "Please try again.");
          }
        }
      }
    } catch {
      // Network/server hard-failure — keep the student's message visible and recoverable.
      toast("error", "Connection problem", "Your message wasn't delivered. Check your connection and try again.");
    } finally {
      setThinking(false);
      setStreaming(false);
    }
  };

  const readMessage = async (text: string) => {
    try {
      await speak(text);
    } catch (error) {
      toast("error", "Could not read response", error instanceof Error ? error.message : "Please try again.");
    }
  };

  // G-o1 staged a voice question → show it in the input (as the user
  // would type it), then send. takePendingQuestion is consume-once and
  // sync-guarded, so StrictMode remounts and re-renders can't double-send.
  const voicePending = go1?.pendingQuestion ?? null;
  React.useEffect(() => {
    if (!voicePending || !go1 || thinking) return;
    const q = go1.takePendingQuestion();
    if (!q) return;
    setInput(q);
    voiceAskedRef.current = true;
    const t = window.setTimeout(() => void send(q), 700);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voicePending]);

  const startNewSession = async () => {
    const res = await newChatSessionAction();
    if (!res.ok) return;
    setMessages([]);
    setActiveId(res.conversationId);
    setSessions((s) => s.map((x) => ({ ...x, active: x.id === res.conversationId })));
    refreshSessions();
  };

  const openSession = async (id: string) => {
    if (id === activeId) return;
    const res = await openChatSessionAction(id);
    if (!res.ok) {
      toast("error", "Couldn't open session", res.error);
      return;
    }
    const msgs = await sessionMessagesAction(id);
    if (!msgs.ok) {
      toast("error", "Couldn't load messages", msgs.error);
      return;
    }
    setActiveId(id);
    setMessages(msgs.messages);
    setSessions((s) => s.map((x) => ({ ...x, active: x.id === id })));
    refreshSessions();
  };

  return (
    <div className="relative mx-auto flex h-[calc(100dvh-9.5rem)] max-w-3xl flex-col">
      {/* Session bar */}
      <div className="flex items-center gap-2 pb-2">
        <button
          onClick={startNewSession}
          className="inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-xs font-semibold text-foreground shadow-raise-sm tactile hover:text-primary cursor-pointer"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" /> New session
        </button>
        <button
          onClick={() => setShowSessions((v) => !v)}
          aria-expanded={showSessions}
          className="inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground shadow-raise-sm tactile hover:text-foreground cursor-pointer"
        >
          <History className="h-3.5 w-3.5" /> Past sessions
          {sessions.length > 1 && (
            <span className="rounded-full bg-muted px-1.5 text-[10px] font-bold tabular-nums">{sessions.length}</span>
          )}
        </button>
      </div>

      {/* Past sessions drawer */}
      {showSessions && (
        <div className="neo-float mb-3 max-h-64 space-y-1 overflow-y-auto rounded-2xl border border-border/60 bg-elevated p-2">
          {sessions.length <= 1 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              No past sessions yet — each time you log in, this chat starts fresh and the old one is saved here.
            </p>
          ) : (
            sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  openSession(s.id);
                  setShowSessions(false);
                }}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-all cursor-pointer",
                s.active ? "bg-primary-soft/80 shadow-inset-sm" : "hover:bg-muted/50",
              )}
              >
                <FileText className={cn("h-4 w-4 shrink-0", s.active ? "text-primary" : "text-muted-foreground")} />
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-[13px] font-semibold", s.active && "text-primary")}>{s.title}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{s.preview}</span>
                </span>
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{s.messageCount} msg</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* messages */}
      <div className="flex-1 space-y-5 overflow-y-auto px-1 py-2">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <span className="neo-float mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
              <Rocket className="h-7 w-7" />
            </span>
            <p className="text-lg font-bold tracking-tight">Hey {userName.split(" ")[0]} 👋</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              I&apos;m Pilot — your study co-pilot. Ask me about your plan, upload materials in the Syllabus page for grounded answers, or ask me anything at all.
            </p>
          </div>
        )}
        <AnimatePresence initial={false}>
        {messages.map((m) => (
          <motion.div
            key={m.id}
            variants={listItem}
            initial="hidden"
            animate="show"
            className={cn("flex gap-3", m.role === "user" ? "flex-row-reverse" : "")}
          >
            {m.role === "assistant" ? (
              <Avatar name="Pilot" size="sm" className="mt-0.5" />
            ) : (
              <Avatar name={userName} size="sm" className="mt-0.5" />
            )}
            <div className={cn("max-w-[82%] rounded-3xl px-4 py-3 text-[13.5px] leading-relaxed", m.role === "user" ? "rounded-br-md bg-primary text-primary-foreground shadow-raise-sm" : "rounded-bl-md border border-border/50 bg-card shadow-raise-sm")}>
              <Rich text={m.content} />
              {m.role === "assistant" && (
                <button
                  type="button"
                  onClick={() => void readMessage(m.content)}
                  disabled={isSpeaking}
                  aria-label="Read response aloud"
                  className="mt-3 inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                >
                  {isSpeaking ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Volume2 className="h-4 w-4" />}
                </button>
              )}
              {m.meta?.actions && m.meta.actions.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {m.meta.actions.map((a) => (
                    <Link
                      key={a.href + a.label}
                      href={a.href}
                      className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
                    >
                      <Sparkles className="h-3 w-3" /> {a.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        ))}
        </AnimatePresence>
        {thinking && (
          <motion.div variants={listItem} initial="hidden" animate="show" className="flex gap-3">
            <Avatar name="Pilot" size="sm" className="mt-0.5" />
            <div className="rounded-3xl rounded-bl-md border border-border/50 bg-card px-4 py-3.5 shadow-raise-sm">
              <span className="flex items-center gap-2 text-muted-foreground" role="status" aria-label={pilotStatus ?? "Pilot is thinking"}>
                <span className="flex items-center gap-1.5" aria-hidden>
                  <span className="thinking-dot" />
                  <span className="thinking-dot" />
                  <span className="thinking-dot" />
                </span>
                {pilotStatus && <span className="text-xs font-medium">{pilotStatus}…</span>}
              </span>
            </div>
          </motion.div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* suggestions */}
      {messages.length < 3 && !thinking && (
        <div className="flex flex-wrap gap-2 pb-2">
          {SUGGESTIONS.slice(0, 5).map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              className="rounded-full bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-raise-sm tactile hover:text-primary cursor-pointer"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* live Pilot status — real streaming state only, never faked */}
      {streaming && (
        <p className="pb-1.5 text-xs font-medium text-muted-foreground" role="status" aria-live="polite">
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 animate-pulse text-primary" aria-hidden />
            Preparing your response…
          </span>
        </p>
      )}

      {/* input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex items-end gap-2 rounded-3xl bg-card p-2 shadow-raise-lg focus-within:ring-2 focus-within:ring-primary/25"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={1}
          placeholder="Ask Pilot anything…"
          aria-label="Message Pilot"
          className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/60"
        />
        <button
          type="submit"
          aria-label="Send message"
          disabled={!input.trim() || thinking}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-raise-sm tactile disabled:opacity-40 cursor-pointer"
        >
          <ArrowUp className="h-4.5 w-4.5" />
        </button>
      </form>
      <p className="pt-2 text-center text-[11px] text-muted-foreground">
        Fresh session every login · past chats saved under “Past sessions” · uploads in Syllabus ground Pilot’s answers
      </p>
    </div>
  );
}
