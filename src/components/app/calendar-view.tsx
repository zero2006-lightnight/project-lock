"use client";

import * as React from "react";
import { useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  CalendarDays,
  Check,
  GraduationCap,
  GripVertical,
  ListTodo,
  Loader2,
} from "lucide-react";
import { addDays, addMonths, addWeeks, format, isSameMonth, parseISO, startOfDay, startOfMonth } from "date-fns";
import { cn } from "@/lib/utils";
import { minutesToClock, todayISO } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toaster";
import { movePlanItemAction } from "@/lib/actions/planning";
import type { PlanItemAgg, TaskAgg } from "@/lib/services/types";

type ViewMode = "week" | "month";

type ExamEvent = {
  id: string;
  name: string;
  date: string;
  subjectName: string | null;
  subjectColor: string | null;
};

type CalendarInitial = {
  plan: PlanItemAgg[];
  tasks: TaskAgg[];
  exams: ExamEvent[];
};

const fmtKey = (d: Date) => format(d, "yyyy-MM-dd");
const WEEK_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function startOfWeekMonday(d: Date): Date {
  const day = (d.getDay() + 6) % 7;
  return addDays(startOfDay(d), -day);
}

const isMovableBlock = (item: PlanItemAgg) =>
  item.status === "pending" &&
  (item.kind === "study" || item.kind === "revision" || item.kind === "review" || item.kind === "focus");

/** minutes-from-midnight → "HH:MM" for <input type="time"> */
const toTimeInput = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/* ── Chips ───────────────────────────────────────────────────── */

function PlanChip({
  item,
  dense,
  dragging,
  busy,
  onDragStart,
  onDragEnd,
  onPointerDown,
  onOpenMove,
}: {
  item: PlanItemAgg;
  dense: boolean;
  dragging: boolean;
  busy: boolean;
  onDragStart: (e: React.DragEvent, item: PlanItemAgg) => void;
  onDragEnd: () => void;
  onPointerDown?: (e: React.PointerEvent, item: PlanItemAgg) => void;
  onOpenMove?: (item: PlanItemAgg) => void;
}) {
  const movable = isMovableBlock(item);
  const done = item.status === "completed";
  const missed = item.status === "missed";
  const skipped = item.status === "skipped";
  const label = item.topicName ?? item.title;
  const color = item.subjectColor;

  const statusStyle = done
    ? "opacity-55"
    : missed
      ? "bg-danger-soft text-danger"
      : skipped
        ? "bg-warning-soft text-warning"
        : undefined;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!movable || !onOpenMove) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpenMove(item);
    }
  };

  return (
    <div
      draggable={movable && !busy}
      data-item-id={item.id}
      role={movable && onOpenMove ? "button" : undefined}
      tabIndex={movable && onOpenMove ? 0 : undefined}
      aria-label={
        movable && onOpenMove
          ? `${label} at ${minutesToClock(item.startMinutes)} — press Enter to move or change time`
          : undefined
      }
      onDragStart={(e) => movable && onDragStart(e, item)}
      onDragEnd={onDragEnd}
      onPointerDown={(e) => movable && onPointerDown?.(e, item)}
      onKeyDown={handleKeyDown}
      title={
        movable
          ? `${item.subjectName ? `${item.subjectName} · ` : ""}${label} — drag to another day, or press Enter to move`
          : `${item.subjectName ? `${item.subjectName} · ` : ""}${label}`
      }
      className={cn(
        "flex items-center gap-1 rounded-lg px-1.5 py-1 shadow-raise-sm",
        statusStyle ?? "bg-card",
        movable && "cursor-grab border border-dashed border-foreground/25 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 touch-none",
        done && "line-through decoration-muted-foreground/60",
        dragging && "opacity-40",
      )}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: color ?? "var(--color-muted-foreground)" }}
        aria-hidden
      />
      <p className={cn("min-w-0 flex-1 truncate font-semibold leading-tight", dense ? "text-[10.5px]" : "text-[11px]")}>
        {label}
      </p>
      {movable && !dense && <GripVertical className="h-2.5 w-2.5 shrink-0 text-muted-foreground/70" />}
      <span className={cn("shrink-0 font-medium tabular-nums text-muted-foreground", dense ? "text-[9.5px]" : "text-[10px]")}>
        {minutesToClock(item.startMinutes)}
      </span>
    </div>
  );
}

function TaskChip({ task, dense }: { task: TaskAgg; dense: boolean }) {
  const done = task.status === "completed";
  return (
    <div
      title={`${task.title} — ${task.deadline ? `due ${format(parseISO(task.deadline), "EEE, MMM d")}` : "no deadline"}`}
      className={cn("flex items-center gap-1 rounded-lg bg-warning-soft px-1.5 py-1 text-warning shadow-inset-sm", done && "opacity-50")}
    >
      <ListTodo className={cn("shrink-0", dense ? "h-2.5 w-2.5" : "h-3 w-3")} />
      <p className={cn("min-w-0 flex-1 truncate font-semibold leading-tight", dense ? "text-[10.5px]" : "text-[11px]")}>
        {task.title}
      </p>
      {done && <Check className={cn("shrink-0", dense ? "h-2.5 w-2.5" : "h-3 w-3")} />}
    </div>
  );
}

function ExamChip({ exam, dense }: { exam: ExamEvent; dense: boolean }) {
  return (
    <div
      title={`${exam.name}${exam.subjectName ? ` · ${exam.subjectName}` : ""} — exam day`}
      className="flex items-center gap-1 rounded-lg bg-danger-soft px-1.5 py-1 text-danger shadow-inset-sm"
    >
      <GraduationCap className={cn("shrink-0", dense ? "h-2.5 w-2.5" : "h-3 w-3")} />
      <p className={cn("min-w-0 flex-1 truncate font-semibold leading-tight", dense ? "text-[10.5px]" : "text-[11px]")}>
        {exam.name}
      </p>
    </div>
  );
}

/* ── Move dialog (keyboard-accessible rescheduling) ──────────── */

type MoveTarget = { item: PlanItemAgg; dateKey: string };

function MoveDialog({
  target,
  onClose,
  onMove,
}: {
  target: MoveTarget | null;
  onClose: () => void;
  onMove: (itemId: string, dateKey: string, startMinutes: number | undefined) => Promise<void>;
}) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [saving, setSaving] = useState(false);
  // Prop-derived initialisation via React's documented render-time state
  // adjustment pattern (same as the Dialog primitive) — no ref-in-render.
  const [initialisedFor, setInitialisedFor] = useState<string | null>(null);

  if (target && target.item.id !== initialisedFor) {
    setInitialisedFor(target.item.id);
    // Month view shows outside-days cells; never initialise with a past date
    // (the server would reject the move outright).
    setDate(target.dateKey < todayISO() ? todayISO() : target.dateKey);
    setTime(toTimeInput(target.item.startMinutes));
  }
  if (!target && initialisedFor !== null) {
    setInitialisedFor(null);
  }

  const submit = async () => {
    if (!target || saving) return;
    const [y, m, d] = date.split("-").map(Number);
    if (!y || !m || !d) return;
    const [hh, mm] = time.split(":").map(Number);
    const minutes = Number.isFinite(hh) && Number.isFinite(mm) ? hh * 60 + mm : undefined;
    if (minutes === undefined || minutes < 0 || minutes > 1439) return;
    setSaving(true);
    try {
      await onMove(target.item.id, `${date}`, minutes);
    } finally {
      setSaving(false);
      onClose();
    }
  };

  return (
    <Dialog
      open={Boolean(target)}
      onClose={onClose}
      title="Move study block"
      description={target ? `${target.item.topicName ?? target.item.title} — pick a day and start time. The planner checks capacity and overlaps for you.` : undefined}
      size="sm"
    >
      <div className="space-y-4">
        <Field label="Date">
          <Input type="date" value={date} min={todayISO()} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Start time" hint={`Block length stays ${target ? target.item.durationMinutes : 0} minutes.`}>
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose} className="cursor-pointer">
            Cancel
          </Button>
          <Button size="sm" disabled={saving || !date || !time} onClick={submit} className="cursor-pointer">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
            Move block
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* ── Main view ───────────────────────────────────────────────── */

export function CalendarView({ initial }: { initial: CalendarInitial }) {
  const { toast } = useToast();
  const today = todayISO();

  const [view, setView] = useState<ViewMode>("month");
  const [monthCursor, setMonthCursor] = useState<Date>(() => startOfMonth(new Date()));
  const [weekCursor, setWeekCursor] = useState<Date>(() => startOfWeekMonday(new Date()));
  const [items, setItems] = useState<PlanItemAgg[]>(initial.plan);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);

  // Touch drag state (pointer-based; HTML5 DnD doesn't fire on touch devices).
  const touchState = useRef<{
    itemId: string;
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
    ghost: HTMLDivElement | null;
    dropMinutes?: number;
  } | null>(null);

  const byDate = useMemo(() => {
    const m = new Map<string, PlanItemAgg[]>();
    for (const it of items) {
      const arr = m.get(it.date);
      if (arr) arr.push(it);
      else m.set(it.date, [it]);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.startMinutes - b.startMinutes);
    return m;
  }, [items]);

  const tasksByDate = useMemo(() => {
    const m = new Map<string, TaskAgg[]>();
    for (const t of initial.tasks) {
      if (!t.deadline) continue;
      const arr = m.get(t.deadline);
      if (arr) arr.push(t);
      else m.set(t.deadline, [t]);
    }
    return m;
  }, [initial.tasks]);

  const examsByDate = useMemo(() => {
    const m = new Map<string, ExamEvent[]>();
    for (const e of initial.exams) {
      const arr = m.get(e.date);
      if (arr) arr.push(e);
      else m.set(e.date, [e]);
    }
    return m;
  }, [initial.exams]);

  const applyMove = async (itemId: string, dateKey: string, startMinutes?: number) => {
    if (busy) return;
    setBusy(true);
    const res = await movePlanItemAction(itemId, dateKey, startMinutes);
    setBusy(false);
    if (!res.ok) {
      toast("error", "Couldn't move block", res.error);
      return;
    }
    setItems((prev) => {
      const it = prev.find((p) => p.id === itemId);
      if (!it) return prev;
      return [
        ...prev.filter((p) => p.id !== itemId),
        { ...it, date: dateKey, ...(startMinutes !== undefined ? { startMinutes } : {}), origin: "rescheduled" as const },
      ];
    });
    toast(
      "success",
      "Block moved",
      `Scheduled for ${format(parseISO(dateKey), "EEEE, MMM d")}${startMinutes !== undefined ? ` at ${minutesToClock(startMinutes)}` : ""}`,
    );
  };

  const dropBlock = async (id: string | null, dateKey: string, startMinutes?: number) => {
    if (!id || busy) return;
    const item = items.find((i) => i.id === id);
    setOverKey(null);
    setDragId(null);
    if (!item || (item.date === dateKey && startMinutes === undefined)) return;
    await applyMove(id, dateKey, startMinutes);
  };

  const cellHandlers = (dateKey: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragId || busy) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (overKey !== dateKey) setOverKey(dateKey);
    },
    onDragLeave: () => setOverKey((prev) => (prev === dateKey ? null : prev)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      void dropBlock(dragId, dateKey);
    },
    // Touch drop target: pointerenter fires for touch only when we take
    // capture with touch-action:none on the chip — see onChipPointerDown.
    onPointerOver: (e: React.PointerEvent) => {
      if (e.pointerType !== "touch" || !touchState.current?.active || busy) return;
      if (overKey !== dateKey) setOverKey(dateKey);
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (e.pointerType !== "touch" || !touchState.current?.active || busy) return;
      const st = touchState.current;
      const dayCell = (e.currentTarget as HTMLElement).closest("[data-date]");
      const key = dayCell?.getAttribute("data-date") ?? dateKey;
      endTouchDrag();
      if (key && st) void dropBlock(st.itemId, key, st.dropMinutes);
    },
  });

  const onDragStart = (e: React.DragEvent, item: PlanItemAgg) => {
    e.dataTransfer.setData("text/plain", item.id);
    e.dataTransfer.effectAllowed = "move";
    setDragId(item.id);
  };
  const onDragEnd = () => {
    setDragId(null);
    setOverKey(null);
  };

  /* ── Touch dragging (Phase 2) ──────────────────────────────── */

  function endTouchDrag() {
    const st = touchState.current;
    if (st?.ghost) st.ghost.remove();
    touchState.current = null;
    setOverKey(null);
    setDragId(null);
    window.removeEventListener("pointermove", onWindowPointerMove);
    window.removeEventListener("pointerup", onWindowPointerUp);
    window.removeEventListener("pointercancel", onWindowPointerCancel);
  }

  function onWindowPointerMove(e: PointerEvent) {
    const st = touchState.current;
    if (!st?.active || st.pointerId !== e.pointerId) return;
    if (st.ghost) {
      st.ghost.style.left = `${e.clientX + 12}px`;
      st.ghost.style.top = `${e.clientY + 10}px`;
    }
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const dayCell = el?.closest("[data-date]");
    const key = dayCell?.getAttribute("data-date") ?? null;
    if (key !== overKey) setOverKey(key);
  }

  function onWindowPointerUp(e: PointerEvent) {
    const st = touchState.current;
    if (!st?.active || st.pointerId !== e.pointerId) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const dayCell = el?.closest("[data-date]");
    const key = dayCell?.getAttribute("data-date") ?? null;
    const { itemId, dropMinutes } = st;
    endTouchDrag();
    if (key) void dropBlock(itemId, key, dropMinutes);
  }

  function onWindowPointerCancel() {
    endTouchDrag();
  }

  const onChipPointerDown = (e: React.PointerEvent, item: PlanItemAgg) => {
    if (e.pointerType !== "touch" || busy) return;
    // Long-press to drag: a simple touch would fight with scrolling.
    const startX = e.clientX;
    const startY = e.clientY;
    const pointerId = e.pointerId;
    const timer = window.setTimeout(() => {
      const ghost = document.createElement("div");
      ghost.textContent = `${item.topicName ?? item.title} — drop on a day`;
      ghost.style.position = "fixed";
      ghost.style.zIndex = "60";
      ghost.style.pointerEvents = "none";
      ghost.style.padding = "4px 10px";
      ghost.style.borderRadius = "999px";
      ghost.style.fontSize = "11px";
      ghost.style.fontWeight = "600";
      ghost.style.background = "var(--color-primary)";
      ghost.style.color = "var(--color-primary-foreground)";
      document.body.appendChild(ghost);
      touchState.current = { itemId: item.id, pointerId, startX, startY, active: true, ghost, dropMinutes: undefined };
      setDragId(item.id);
      window.addEventListener("pointermove", onWindowPointerMove);
      window.addEventListener("pointerup", onWindowPointerUp);
      window.addEventListener("pointercancel", onWindowPointerCancel);
    }, 350);
    // A finger that moves >12px before activation is a scroll, not a drag.
    const onPendingMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (Math.abs(ev.clientX - startX) > 12 || Math.abs(ev.clientY - startY) > 12) {
        window.clearTimeout(timer);
        window.removeEventListener("pointermove", onPendingMove);
        window.removeEventListener("pointerup", cancel);
        window.removeEventListener("pointercancel", cancel);
      }
    };
    const cancel = () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", onPendingMove);
      window.removeEventListener("pointerup", cancel);
      window.removeEventListener("pointercancel", cancel);
    };
    window.addEventListener("pointermove", onPendingMove);
    window.addEventListener("pointerup", cancel);
    window.addEventListener("pointercancel", cancel);
  };

  // Registered on the chip via onPointerDown wrapper so cancel listeners
  // attach per-touch; the long-press activates the drag session.
  const chipPointerDown = (e: React.PointerEvent, item: PlanItemAgg) => onChipPointerDown(e, item);

  const renderDateHeader = (date: Date, isOutside: boolean) => {
    const key = fmtKey(date);
    const isToday = key === today;
    return (
      <div className="flex items-center">
        <span
          className={cn(
            "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-bold tabular-nums",
            isToday ? "bg-primary text-primary-foreground" : isOutside ? "text-muted-foreground/50" : "text-foreground",
          )}
        >
          {date.getDate()}
        </span>
      </div>
    );
  };

  const rangeLabel =
    view === "month"
      ? format(monthCursor, "MMMM yyyy")
      : `${format(weekCursor, "MMM d")} – ${format(addDays(weekCursor, 6), "MMM d, yyyy")}`;

  const stepBack = () => (view === "month" ? setMonthCursor((c) => addMonths(c, -1)) : setWeekCursor((c) => addWeeks(c, -1)));
  const stepForward = () => (view === "month" ? setMonthCursor((c) => addMonths(c, 1)) : setWeekCursor((c) => addWeeks(c, 1)));
  const goToday = () => {
    setMonthCursor(startOfMonth(new Date()));
    setWeekCursor(startOfWeekMonday(new Date()));
  };

  /* Month grid — Monday-first, 6 rows */
  const monthStart = useMemo(() => {
    const first = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1);
    const day = (first.getDay() + 6) % 7;
    return addDays(first, -day);
  }, [monthCursor]);
  const monthCells = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(monthStart, i)), [monthStart]);

  /* Week strip */
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekCursor, i)), [weekCursor]);

  const cellClass = (key: string, isOutside: boolean) =>
    cn(
      "relative flex min-h-0 flex-col gap-1 overflow-hidden bg-transparent p-1.5 transition-colors",
      isOutside && "opacity-60",
      key === today && "bg-primary-soft/40",
      overKey === key && "bg-primary-soft/50 ring-2 ring-inset ring-primary/70",
    );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Calendar</h1>
          <p className="mt-1 text-sm text-muted-foreground">{rangeLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* View toggle */}
          <div className="flex rounded-xl bg-muted p-0.5 shadow-inset-sm" role="tablist" aria-label="Calendar view">
            {(["week", "month"] as const).map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={cn(
                  "rounded-[10px] px-3.5 py-1.5 text-sm font-semibold capitalize transition-all cursor-pointer",
                  view === v ? "bg-card text-foreground shadow-raise-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {v === "week" ? "Week" : "Month"}
              </button>
            ))}
          </div>
          <button
            onClick={stepBack}
            aria-label={`Previous ${view}`}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-card text-muted-foreground shadow-raise-sm tactile hover:text-foreground cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button
            onClick={goToday}
            className="inline-flex h-9 items-center justify-center rounded-xl bg-secondary text-secondary-foreground shadow-raise-sm tactile cursor-pointer"
          >
            Today
          </button>
          <button
            onClick={stepForward}
            aria-label={`Next ${view}`}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-card text-muted-foreground shadow-raise-sm tactile hover:text-foreground cursor-pointer"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── WEEK VIEW ─────────────────────────────────────────── */}
      {view === "week" && (
        <div className="grid gap-2.5 md:grid-cols-7">
          {weekDays.map((d) => {
            const key = fmtKey(d);
            const isToday = key === today;
            const isWeekend = d.getDay() === 0 || d.getDay() === 6;
            const blocks = (byDate.get(key) ?? []).filter((b) => b.kind !== "break");
            const tasks = tasksByDate.get(key) ?? [];
            const exams = examsByDate.get(key) ?? [];
            return (
              <div
                key={key}
                data-date={key}
                {...cellHandlers(key)}
                className={cn(
                  "flex min-h-44 flex-col rounded-2xl bg-muted/50 shadow-inset-sm transition-colors",
                  isToday && "bg-primary-soft/30 ring-2 ring-primary/15",
                  overKey === key && "bg-primary-soft/60 ring-2 ring-inset ring-primary/70",
                )}
              >
                <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
                  <p className={cn("text-[13px] font-bold", isToday ? "text-primary" : isWeekend ? "text-muted-foreground" : "text-foreground")}>
                    {format(d, "EEE")}
                    <span className="ml-1 text-[11px] font-medium text-muted-foreground">{format(d, "d")}</span>
                  </p>
                  {isToday && (
                    <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-foreground shadow-raise-sm">Today</span>
                  )}
                </div>
                <div className="space-y-1.5 px-2.5 pb-2.5">
                  {exams.map((e) => (
                    <ExamChip key={e.id} exam={e} dense={false} />
                  ))}
                  {tasks.map((t) => (
                    <TaskChip key={t.id} task={t} dense={false} />
                  ))}
                  {blocks.map((b) => (
                    <PlanChip
                      key={b.id}
                      item={b}
                      dense={false}
                      dragging={dragId === b.id}
                      busy={busy}
                      onDragStart={onDragStart}
                      onDragEnd={onDragEnd}
                      onPointerDown={chipPointerDown}
                      onOpenMove={(item) => setMoveTarget({ item, dateKey: key })}
                    />
                  ))}
                  {blocks.length === 0 && tasks.length === 0 && exams.length === 0 && (
                    <p className="py-4 text-center text-[11px] text-muted-foreground/50">—</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── MONTH VIEW ────────────────────────────────────────── */}
      {view === "month" && (
        <div className="overflow-x-auto rounded-2xl bg-card py-1 neo-raise">
          <div className="min-w-[860px]">
            {/* Weekday header */}
            <div className="grid grid-cols-7 gap-px border-b border-border/70 bg-muted/40">
              {WEEK_LABELS.map((label, i) => (
                <p
                  key={label}
                  className={cn(
                    "px-3 py-2 text-[11px] font-bold uppercase tracking-wider",
                    i >= 5 ? "text-muted-foreground" : "text-muted-foreground",
                  )}
                >
                  {label}
                </p>
              ))}
            </div>
            {/* Cells */}
            <div className="grid grid-cols-7 gap-px bg-border/60">
              {monthCells.map((d) => {
                const key = fmtKey(d);
                const outside = !isSameMonth(d, monthCursor);
                const isToday = key === today;
                const blocks = (byDate.get(key) ?? []).filter((b) => b.kind !== "break");
                const tasks = tasksByDate.get(key) ?? [];
                const exams = examsByDate.get(key) ?? [];
                const chips: { type: "exam" | "task" | "plan"; id: string; node: React.ReactNode }[] = [
                  ...exams.map((e) => ({ type: "exam" as const, id: `e-${e.id}`, node: <ExamChip key={e.id} exam={e} dense /> })),
                  ...tasks.map((t) => ({ type: "task" as const, id: `t-${t.id}`, node: <TaskChip key={t.id} task={t} dense /> })),
                  ...blocks.map((b) => ({
                    type: "plan" as const,
                    id: `p-${b.id}`,
                    node: (
                      <PlanChip
                        key={b.id}
                        item={b}
                        dense
                        dragging={dragId === b.id}
                        busy={busy}
                        onDragStart={onDragStart}
                        onDragEnd={onDragEnd}
                        onPointerDown={chipPointerDown}
                        onOpenMove={(item) => setMoveTarget({ item, dateKey: key })}
                      />
                    ),
                  })),
                ];
                const maxChips = 3;
                const visible = chips.slice(0, maxChips);
                const overflow = chips.length - visible.length;
                return (
                  <div key={key} data-date={key} {...cellHandlers(key)} className={cn(cellClass(key, outside), "min-h-[104px]")}>
                    <div className="flex items-center justify-between">
                      {renderDateHeader(d, outside)}
                  {isToday && (
                    <span className="rounded-full bg-primary px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-primary-foreground shadow-raise-sm">
                      Today
                    </span>
                  )}
                    </div>
                    <div className="space-y-1">
                      {visible.map((c) => (
                        <React.Fragment key={c.id}>{c.node}</React.Fragment>
                      ))}
                      {overflow > 0 && (
                        <p className="px-1 text-[10px] font-semibold text-muted-foreground">+{overflow} more</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Legend + drag hint */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-2xl bg-card px-5 py-3.5 text-xs text-muted-foreground neo-raise-sm">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-primary" /> Study block
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-success" /> Completed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-warning" /> Deadline
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-danger" /> Exam
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5">
          <CalendarDays className="h-3.5 w-3.5" />
          Drag a block to another day · press Enter on a block to move it · long-press to drag on touch
        </span>
      </div>

      <MoveDialog
        target={moveTarget}
        onClose={() => setMoveTarget(null)}
        onMove={async (itemId, dateKey, startMinutes) => {
          await applyMove(itemId, dateKey, startMinutes);
        }}
      />
    </div>
  );
}
