"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Edit3,
  FilePlus2,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/skeleton";
import { Ring } from "@/components/ui/progress";
import { useToast } from "@/components/ui/toaster";
import {
  addTopicAction,
  addUnitAction,
  deleteTopicAction,
  deleteUnitAction,
  setTopicStatusAction,
  updateTopicAction,
} from "@/lib/actions/curriculum";
import type { SubjectAgg, TopicAgg } from "@/lib/services/types";

const STATUS_ORDER = ["not_started", "learning", "completed", "needs_revision"] as const;
const STATUS_LABEL: Record<string, string> = {
  not_started: "Not started",
  learning: "Learning",
  completed: "Completed",
  needs_revision: "Needs revision",
};

function StatusSelect({ topic, onChange }: { topic: TopicAgg; onChange: (s: TopicAgg["status"]) => void }) {
  return (
    <select
      value={topic.status}
      aria-label={`Status of ${topic.name}`}
      onChange={(e) => onChange(e.target.value as TopicAgg["status"])}
      className={cn(
        "cursor-pointer rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring/50",
        topic.status === "completed" && "border-success/30 bg-success-soft text-success",
        topic.status === "learning" && "border-info/30 bg-info-soft text-info",
        topic.status === "needs_revision" && "border-warning/30 bg-warning-soft text-warning",
        topic.status === "not_started" && "border-border bg-muted text-muted-foreground",
      )}
    >
      {STATUS_ORDER.map((s) => (
        <option key={s} value={s}>
          {STATUS_LABEL[s]}
        </option>
      ))}
    </select>
  );
}

function TopicRow({
  topic,
  onStatus,
  onEdit,
  onDelete,
}: {
  topic: TopicAgg;
  onStatus: (s: TopicAgg["status"]) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="group flex items-start gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-muted/50">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={`Expand ${topic.name}`}
        className="mt-0.5 rounded-md p-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className={cn("text-[13.5px] font-medium", topic.status === "completed" && "text-muted-foreground line-through")}>
            {topic.name}
          </p>
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground" title={`Difficulty ${topic.difficulty}/5`}>
            {Array.from({ length: 5 }).map((_, i) => (
              <span
                key={i}
                className={cn("h-1 w-1 rounded-full", i < Math.max(1, topic.difficulty) ? "bg-primary/70" : "bg-border")}
              />
            ))}
          </span>
        </div>
        {open && topic.description && (
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{topic.description}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <StatusSelect topic={topic} onChange={onStatus} />
        <Button size="icon-sm" variant="ghost" aria-label="Edit topic" onClick={onEdit}>
          <Edit3 className="h-3.5 w-3.5" />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label="Delete topic" onClick={onDelete} className="text-danger">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function SyllabusManager({ subjects }: { subjects: SubjectAgg[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = React.useState(subjects[0]?.id ?? "");
  const [query, setQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const selected = subjects.find((s) => s.id === selectedId) ?? subjects[0];

  React.useEffect(() => {
    const stored = window.localStorage.getItem("studypilot-syllabus-subject");
    if (stored && subjects.some((subject) => subject.id === stored)) setSelectedId(stored);
  }, [subjects]);

  const selectSubject = (id: string) => {
    setSelectedId(id);
    window.localStorage.setItem("studypilot-syllabus-subject", id);
    setQuery("");
    setStatusFilter("all");
  };

  const [editing, setEditing] = React.useState<TopicAgg | null>(null);
  const [addingTopic, setAddingTopic] = React.useState<string | false>(false);
  // Bumped each time the add-topic dialog opens: the dialog remounts with
  // fresh form state (no setState-in-effect) while keeping the same
  // instance during close so the exit animation still plays.
  const [topicFormSeq, setTopicFormSeq] = React.useState(0);
  const [addingUnit, setAddingUnit] = React.useState(false);
  const [newUnitName, setNewUnitName] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, successMsg?: string) => {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (!res.ok) {
      toast("error", "Something went wrong", res.error);
      return;
    }
    if (successMsg) toast("success", successMsg);
    router.refresh();
  };

  if (!selected) {
    return (
      <EmptyState
        icon={<BookOpen className="h-6 w-6" />}
        title="Your study journey starts here"
        description="Add your first subject and we'll help you map the syllabus."
      />
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
      {/* Subject rail */}
      <div className="space-y-2 lg:sticky lg:top-20 lg:self-start">
        {subjects.map((s) => (
          <button
            key={s.id}
            onClick={() => selectSubject(s.id)}
            className={cn(
              "flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition-all duration-200 cursor-pointer",
              s.id === selected.id
                ? "bg-primary-soft/70 shadow-inset-sm ring-1 ring-inset ring-primary/25"
                : "bg-card shadow-raise-sm hover:shadow-raise",
            )}
          >
            <span className="h-9 w-9 shrink-0 rounded-xl" style={{ background: `${s.color}22` }}>
              <span className="flex h-full w-full items-center justify-center text-sm font-bold" style={{ color: s.color }}>
                {s.name.slice(0, 1)}
              </span>
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold">{s.name}</p>
              <p className="text-[11px] text-muted-foreground">{s.progress}% · {s.completedTopics}/{s.totalTopics || 0} topics</p>
            </div>
            {s.id === selected.id && <Check className="h-4 w-4 shrink-0 text-primary" />}
          </button>
        ))}
      </div>

      {/* Syllabus body */}
      <Card>
        <CardBody className="pt-5">
          <div className="mb-5 grid gap-4 rounded-2xl bg-primary-soft/40 p-4 sm:grid-cols-[auto_1fr] sm:items-center">
            <Ring value={selected.progress} size={92} stroke={9} label={`${selected.progress}%`} sublabel="complete" />
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Selected subject</p>
              <h2 className="mt-1 text-xl font-bold tracking-tight">{selected.name}</h2>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>{selected.completedTopics}/{selected.totalTopics} topics complete</span>
                <span>{selected.units.length} units</span>
                <span>≈ {selected.estimatedHours}h remaining</span>
                {selected.exam && <span>{selected.exam.name} in {selected.exam.daysLeft}d</span>}
              </div>
              {selected.weakTopics.length > 0 && (
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  <span className="font-semibold text-warning">Needs attention: </span>
                  {selected.weakTopics.slice(0, 5).map((w) => w.name).join(", ")}
                  {selected.weakTopics.length > 5 && ` +${selected.weakTopics.length - 5} more`}
                </p>
              )}
            </div>
          </div>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight">
                <span className="h-3 w-3 rounded-full" style={{ background: selected.color }} />
                {selected.name}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {selected.totalTopics} topics · {selected.weakTopics.length > 0 && `${selected.weakTopics.length} flagged`}
                {selected.exam ? ` · ${selected.exam.name} in ${selected.exam.daysLeft}d` : ""}
              </p>
            </div>
            <Button size="sm" loading={busy} onClick={() => setAddingUnit(true)}>
              <Plus className="h-4 w-4" /> Add unit
            </Button>
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            <label className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search units and topics" className="h-10 w-full rounded-[6px] border-2 border-ink bg-input pl-9 pr-3 text-sm outline-none focus:shadow-[4px_4px_0_0_var(--brutal-focus)]" aria-label="Search syllabus" />
            </label>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-auto min-w-36">
              <option value="all">All statuses</option>
              <option value="not_started">Not started</option>
              <option value="learning">Learning</option>
              <option value="needs_revision">Needs revision</option>
              <option value="completed">Completed</option>
            </Select>
          </div>

          {selected.units.length === 0 && (
            <EmptyState
              compact
              icon={<FilePlus2 className="h-6 w-6" />}
              title="No syllabus yet"
              description="Add units and topics — StudyPilot uses them to plan every session."
              action={
                <Button size="sm" onClick={() => setAddingUnit(true)}>
                  <Plus className="h-4 w-4" /> Add first unit
                </Button>
              }
            />
          )}

          <div className="space-y-4">
            {selected.units.map((unit) => {
              const normalizedQuery = query.trim().toLowerCase();
              const topics = unit.topics.filter((topic) =>
                (!normalizedQuery || `${unit.name} ${topic.name} ${topic.description ?? ""}`.toLowerCase().includes(normalizedQuery)) &&
                (statusFilter === "all" || topic.status === statusFilter),
              );
              if (normalizedQuery && !unit.name.toLowerCase().includes(normalizedQuery) && topics.length === 0) return null;
              return (
              <div key={unit.id} className="rounded-2xl bg-muted/40 shadow-inset-sm">
                <div className="flex items-center gap-2 px-4 py-3">
                  <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <p className="flex-1 text-sm font-semibold">{unit.name}</p>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Add topic to ${unit.name}`}
                    onClick={() => {
                      setAddingUnit(false);
                      setTopicFormSeq((s) => s + 1);
                      setAddingTopic(unit.id);
                    }}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete unit ${unit.name}`}
                    className="text-danger"
                    onClick={() => run(() => deleteUnitAction(unit.id), "Unit deleted")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="border-t border-border/70 px-2 pb-2">
                  {unit.topics.length === 0 && (
                    <p className="px-3 py-3 text-center text-xs text-muted-foreground">No topics yet — add the first one.</p>
                  )}
                  {topics.map((t) => (
                    <TopicRow
                      key={t.id}
                      topic={t}
                      onStatus={(s) => run(() => setTopicStatusAction(t.id, s), s === "completed" ? "Topic completed 🎉" : "Status updated")}
                      onEdit={() => setEditing(t)}
                      onDelete={() => run(() => deleteTopicAction(t.id), "Topic deleted")}
                    />
                  ))}
                </div>
              </div>
              );
            })}
          </div>
        </CardBody>
      </Card>

      {/* Add unit dialog */}
      <Dialog
        open={addingUnit}
        onClose={() => setAddingUnit(false)}
        title="Add a unit"
        description={`Add a unit to ${selected.name}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddingUnit(false)}>
              Cancel
            </Button>
            <Button
              loading={busy}
              onClick={() =>
                run(async () => {
                  const res = await addUnitAction(selected.id, newUnitName);
                  setNewUnitName("");
                  setAddingUnit(false);
                  return res;
                }, "Unit added")
              }
            >
              Add unit
            </Button>
          </>
        }
      >
        <Field label="Unit name" required>
          <Input
            autoFocus
            value={newUnitName}
            onChange={(e) => setNewUnitName(e.target.value)}
            placeholder="e.g. Unit 2 — Sorting & Searching"
          />
        </Field>
      </Dialog>

      {/* Add topic dialog — key remounts the form each time so its state
          resets without a setState-in-effect (React-recommended pattern). */}
      <AddTopicDialog
        key={topicFormSeq}
        open={Boolean(addingTopic)}
        unitId={typeof addingTopic === "string" ? addingTopic : ""}
        onClose={() => setAddingTopic(false)}
        onDone={(msg) => {
          setAddingTopic(false);
          if (msg) toast("success", msg);
          router.refresh();
        }}
      />

      {/* Edit topic dialog */}
      <Dialog
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title="Edit topic"
        description={editing?.name}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              loading={busy}
              onClick={() =>
                run(
                  async () => {
                    if (!editing) return { ok: false as const, error: "No topic" };
                    const res = await updateTopicAction(editing.id, {
                      name: editing.name,
                      difficulty: editing.difficulty,
                      description: editing.description ?? undefined,
                    });
                    setEditing(null);
                    return res;
                  },
                  "Topic updated",
                )
              }
            >
              Save
            </Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-4">
            <Field label="Topic name" required>
              <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            <Field label="Difficulty (1–5)">
              <Select value={editing.difficulty} onChange={(e) => setEditing({ ...editing, difficulty: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5].map((d) => (
                  <option key={d} value={d}>
                    {d} — {["Very easy", "Easy", "Moderate", "Hard", "Very hard"][d - 1]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Description" hint="A short summary the planner and Pilot can reference.">
              <Textarea
                value={editing.description ?? ""}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              />
            </Field>
          </div>
        )}
      </Dialog>
    </div>
  );
}

function AddTopicDialog({
  open,
  unitId,
  onClose,
  onDone,
}: {
  open: boolean;
  unitId: string;
  onClose: () => void;
  onDone: (msg?: string) => void;
}) {
  const [name, setName] = React.useState("");
  const [difficulty, setDifficulty] = React.useState(3);
  const [description, setDescription] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  // State resets via the parent's remount `key` — no effect needed.

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a topic"
      description="Topics become the building blocks of your study plan."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={!name.trim()}
            onClick={async () => {
              setBusy(true);
              const res = await addTopicAction(unitId, { name, difficulty, description: description || undefined });
              setBusy(false);
              onDone(res.ok ? "Topic added" : undefined);
            }}
          >
            Add topic
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Topic name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Dijkstra's Algorithm" autoFocus />
        </Field>
        <Field label="Difficulty (1–5)">
          <Select value={difficulty} onChange={(e) => setDifficulty(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((d) => (
              <option key={d} value={d}>
                {d} — {["Very easy", "Easy", "Moderate", "Hard", "Very hard"][d - 1]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Description (optional)" hint="Helps Pilot explain and quiz you on it.">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

