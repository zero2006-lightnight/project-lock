"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Edit3, FileText, ListTodo, Plus, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { Badge, PriorityBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toaster";
import {
  addTaskAction,
  deleteTaskAction,
  setTaskStatusAction,
  updateTaskAction,
} from "@/lib/actions/curriculum";
import type { TaskAgg } from "@/lib/services/types";

const KIND_LABEL: Record<string, string> = {
  assignment: "Assignment",
  project: "Project",
  lab: "Lab",
  quiz: "Quiz",
  revision: "Revision",
  other: "Other",
};

function TaskForm({
  initial,
  subjects,
  onDone,
}: {
  initial?: TaskAgg;
  subjects: { id: string; name: string }[];
  onDone: (ok: boolean) => void;
}) {
  const [title, setTitle] = React.useState(initial?.title ?? "");
  const [subjectId, setSubjectId] = React.useState(initial?.subjectId ?? subjects[0]?.id ?? "");
  const [kind, setKind] = React.useState(initial?.kind ?? "assignment");
  const [deadline, setDeadline] = React.useState(initial?.deadline ?? "");
  const [priority, setPriority] = React.useState(initial?.priority ?? 2);
  const [estimatedMinutes, setEstimatedMinutes] = React.useState(initial?.estimatedMinutes ?? 60);
  const [notes, setNotes] = React.useState(initial?.notes ?? "");
  const [busy, setBusy] = React.useState(false);

  return (
    <div className="space-y-4">
      <Field label="Title" required>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Submit sorting lab report" autoFocus />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Subject">
          <Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            <option value="">No subject</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Kind">
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            {Object.entries(KIND_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Deadline">
          <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </Field>
        <Field label="Priority">
          <Select value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
            <option value={1}>Low</option>
            <option value={2}>Medium</option>
            <option value={3}>High</option>
          </Select>
        </Field>
        <Field label="Est. minutes">
          <Input
            type="number"
            min={5}
            step={5}
            value={estimatedMinutes}
            onChange={(e) => setEstimatedMinutes(Number(e.target.value))}
          />
        </Field>
      </div>
      <Field label="Notes (optional)">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="flex justify-end">
        <Button
          loading={busy}
          disabled={!title.trim()}
          onClick={async () => {
            setBusy(true);
            const payload = {
              title,
              subjectId: subjectId || null,
              kind: kind as never,
              deadline: deadline || null,
              priority,
              estimatedMinutes,
              notes: notes || null,
            };
            const res = initial
              ? await updateTaskAction(initial.id, payload)
              : await addTaskAction(payload);
            setBusy(false);
            onDone(res.ok);
          }}
        >
          {initial ? "Save changes" : "Add task"}
        </Button>
      </div>
    </div>
  );
}

export function TaskManager({ tasks, subjects }: { tasks: TaskAgg[]; subjects: { id: string; name: string }[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [filter, setFilter] = React.useState<"all" | "todo" | "in_progress" | "completed" | "skipped">("all");
  const [addOpen, setAddOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<TaskAgg | null>(null);

  const filtered = tasks.filter((t) => filter === "all" || t.status === filter);
  const counts = {
    all: tasks.length,
    todo: tasks.filter((t) => t.status === "todo").length,
    in_progress: tasks.filter((t) => t.status === "in_progress").length,
    completed: tasks.filter((t) => t.status === "completed").length,
    skipped: tasks.filter((t) => t.status === "skipped").length,
  };

  const toggle = async (t: TaskAgg) => {
    const next = t.status === "completed" ? "todo" : "completed";
    await setTaskStatusAction(t.id, next);
    toast("success", next === "completed" ? "Task completed 🎉" : "Task reopened");
    router.refresh();
  };

  return (
    <div className="space-y-5">
      {/* filter chips */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter tasks">
          {(["all", "todo", "in_progress", "completed", "skipped"] as const).map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-150 cursor-pointer",
                filter === f ? "bg-primary text-primary-foreground shadow-raise-sm" : "bg-muted/70 text-muted-foreground shadow-inset-sm hover:text-foreground",
              )}
            >
              {f === "all" ? "All" : f.replace("_", " ")} · {counts[f]}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> Add task
        </Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<ListTodo className="h-6 w-6" />}
          title={tasks.length === 0 ? "No tasks yet" : "Nothing in this view"}
          description={
            tasks.length === 0
              ? "Assignments, projects and quizzes all live here — deadlines feed straight into your daily plan."
              : "Try another filter, or add something new."
          }
          action={
            tasks.length === 0 ? (
              <Button onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4" /> Add task
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((t) => {
            const done = t.status === "completed";
            return (
              <Card key={t.id} className={cn(done && "opacity-70")}>
                <CardBody className="flex items-center gap-3 py-3">
                  <button
                    onClick={() => toggle(t)}
                    aria-label={done ? "Reopen task" : "Mark task complete"}
                    className={cn(
                      "flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full transition-all cursor-pointer",
                      done ? "bg-success text-white shadow-raise-sm" : "bg-muted shadow-inset-sm hover:shadow-inset",
                    )}
                  >
                    {done && <Check className="h-3 w-3" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm font-semibold", done && "text-muted-foreground line-through")}>{t.title}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.subjectColor ?? "var(--color-muted-foreground)" }} />
                        {t.subjectName ?? "General"}
                      </span>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        <FileText className="h-3 w-3" /> {KIND_LABEL[t.kind] ?? t.kind}
                      </span>
                      {t.deadline && (
                        <>
                          <span>·</span>
                          <span className={cn(t.daysLeft !== null && t.daysLeft <= 2 && !done && "font-semibold text-danger")}>
                            Due {t.daysLeft === 0 ? "today" : t.daysLeft === 1 ? "tomorrow" : format(parseISO(t.deadline), "MMM d")}
                          </span>
                        </>
                      )}
                      <span>·</span>
                      <span>{t.estimatedMinutes}m</span>
                    </p>
                    {t.notes && <p className="mt-1 text-xs text-muted-foreground">{t.notes}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <PriorityBadge priority={t.priority} />
                    <Badge tone={t.status === "in_progress" ? "primary" : "neutral"}>{t.status.replace("_", " ")}</Badge>
                    <Button size="icon-sm" variant="ghost" aria-label={`Edit ${t.title}`} onClick={() => setEditing(t)}>
                      <Edit3 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Delete ${t.title}`}
                      className="text-danger"
                      onClick={async () => {
                        await deleteTaskAction(t.id);
                        toast("success", "Task deleted");
                        router.refresh();
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add a task"
        description="Tasks with deadlines get planned blocks automatically in the days before they're due."
        footer={
          <Button variant="ghost" onClick={() => setAddOpen(false)}>
            Cancel
          </Button>
        }
      >
        <TaskForm
          subjects={subjects}
          onDone={(ok) => {
            setAddOpen(false);
            if (ok) {
              toast("success", "Task added");
              router.refresh();
            }
          }}
        />
      </Dialog>

      <Dialog
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title="Edit task"
        footer={
          <Button variant="ghost" onClick={() => setEditing(null)}>
            Cancel
          </Button>
        }
      >
        {editing && (
          <TaskForm
            initial={editing}
            subjects={subjects}
            onDone={(ok) => {
              setEditing(null);
              if (ok) {
                toast("success", "Task updated");
                router.refresh();
              }
            }}
          />
        )}
      </Dialog>
    </div>
  );
}