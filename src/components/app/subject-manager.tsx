"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BookOpen, CalendarClock, Edit3, Plus, Trash2, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardBody } from "@/components/ui/card";
import { Badge, DifficultyDots, PriorityBadge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toaster";
import { createSubjectAction, deleteSubjectAction, updateSubjectAction } from "@/lib/actions/curriculum";
import type { SubjectAgg } from "@/lib/services/types";

const COLORS = ["#5753d4", "#8b5cf6", "#0ea5e9", "#10b981", "#f59e0b", "#f43f5e", "#ec4899", "#6366f1", "#14b8a6"];

function SubjectForm({
  initial,
  onDone,
}: {
  initial?: SubjectAgg;
  onDone: (ok: boolean, msg?: string) => void;
}) {
  const [name, setName] = React.useState(initial?.name ?? "");
  const [color, setColor] = React.useState(initial?.color ?? COLORS[0]);
  const [priority, setPriority] = React.useState(initial?.priority ?? 2);
  const [difficulty, setDifficulty] = React.useState(initial?.difficulty ?? 2);
  const [busy, setBusy] = React.useState(false);

  return (
    <div className="space-y-4">
      <Field label="Subject name" required>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Data Structures" autoFocus />
      </Field>
      <Field label="Color">
        <div className="flex flex-wrap gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={`Use color ${c}`}
              className={cn(
                "h-8 w-8 rounded-full transition-transform hover:scale-110 cursor-pointer",
                color === c && "ring-2 ring-ring ring-offset-2 ring-offset-card",
              )}
              style={{ background: c }}
            />
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Priority">
          <Select value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
            <option value={1}>Low</option>
            <option value={2}>Medium</option>
            <option value={3}>High</option>
          </Select>
        </Field>
        <Field label="Difficulty">
          <Select value={difficulty} onChange={(e) => setDifficulty(Number(e.target.value))}>
            <option value={1}>Easy</option>
            <option value={2}>Moderate</option>
            <option value={3}>Hard</option>
          </Select>
        </Field>
      </div>
      <div className="flex justify-end gap-2.5 pt-1">
        <Button
          loading={busy}
          disabled={!name.trim()}
          onClick={async () => {
            setBusy(true);
            const res = initial
              ? await updateSubjectAction(initial.id, { name, color, priority, difficulty })
              : await createSubjectAction({ name, color, priority, difficulty });
            setBusy(false);
            onDone(res.ok, initial ? "Subject updated" : "Subject added");
          }}
        >
          {initial ? "Save changes" : "Add subject"}
        </Button>
      </div>
    </div>
  );
}

export function SubjectManager({ subjects }: { subjects: SubjectAgg[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [addOpen, setAddOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<SubjectAgg | null>(null);
  const [deleting, setDeleting] = React.useState<SubjectAgg | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {subjects.length} subject{subjects.length === 1 ? "" : "s"} · {subjects.reduce((a, s) => a + s.completedTopics, 0)} topics completed
        </p>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> Add subject
        </Button>
      </div>

      {subjects.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="h-6 w-6" />}
          title="No subjects yet"
          description="Add your subjects and we'll build your personalized study roadmap from the syllabus."
          action={
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" /> Add subject
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {subjects.map((s) => (
            <Card key={s.id} interactive className="flex flex-col">
              <CardBody className="flex flex-1 flex-col">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold" style={{ background: `${s.color}22`, color: s.color }}>
                      {s.name.slice(0, 1)}
                    </span>
                    <div>
                      <p className="text-[15px] font-semibold leading-tight">{s.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {s.completedTopics}/{s.totalTopics || 0} topics
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="icon-sm" variant="ghost" aria-label={`Edit ${s.name}`} onClick={() => setEditing(s)}>
                      <Edit3 className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon-sm" variant="ghost" aria-label={`Delete ${s.name}`} className="text-danger" onClick={() => setDeleting(s)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="mb-4">
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Syllabus progress</span>
                    <span className="font-semibold tabular-nums">{s.progress}%</span>
                  </div>
                  <Progress value={s.progress} tone={s.progress >= 80 ? "success" : "primary"} />
                </div>

                <div className="mt-auto space-y-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <PriorityBadge priority={s.priority} />
                    <Badge tone="neutral">
                      <DifficultyDots level={s.difficulty} max={3} />
                      <span className="ml-1.5">Difficulty</span>
                    </Badge>
                    {s.exam && (
                      <Badge tone={s.exam.daysLeft <= 7 ? "danger" : "warning"}>
                        <CalendarClock className="h-3 w-3" /> {s.exam.daysLeft}d
                      </Badge>
                    )}
                  </div>
                  {s.exam && (
                    <p className="text-xs text-muted-foreground">
                      {s.exam.name} · in {s.exam.daysLeft} day{s.exam.daysLeft === 1 ? "" : "s"}
                    </p>
                  )}
                  {s.weakTopics.length > 0 && (
                    <div className="rounded-xl bg-warning-soft/50 px-3 py-2">
                      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-warning">
                        <Zap className="h-3 w-3" /> Weak areas
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{s.weakTopics.map((w) => w.name).join(", ")}</p>
                    </div>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add a subject"
        description="Subjects anchor your syllabus, exams and study plan."
        footer={
          <Button variant="ghost" onClick={() => setAddOpen(false)}>
            Cancel
          </Button>
        }
      >
        <SubjectForm
          onDone={(ok, msg) => {
            setAddOpen(false);
            if (ok) toast("success", msg ?? "Added");
            router.refresh();
          }}
        />
      </Dialog>

      <Dialog
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={`Edit ${editing?.name ?? "subject"}`}
        footer={
          <Button variant="ghost" onClick={() => setEditing(null)}>
            Cancel
          </Button>
        }
      >
        {editing && (
          <SubjectForm
            initial={editing}
            onDone={(ok, msg) => {
              setEditing(null);
              if (ok) toast("success", msg ?? "Saved");
              router.refresh();
            }}
          />
        )}
      </Dialog>

      <Dialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete subject?"
        description={`"${deleting?.name}" and its entire syllabus will be removed. This cannot be undone.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (!deleting) return;
                await deleteSubjectAction(deleting.id);
                setDeleting(null);
                toast("success", "Subject deleted");
                router.refresh();
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">Exams linked to this subject will be kept but unlinked.</p>
      </Dialog>
    </div>
  );
}