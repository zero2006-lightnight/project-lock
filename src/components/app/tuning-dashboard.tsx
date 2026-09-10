"use client";

import * as React from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Database,
  FileText,
  ImagePlus,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, variantClasses, sizeClasses } from "@/components/ui/button";
import { listItem } from "@/components/motion/variants";
import {
  askTuningAction,
  createKnowledgeBaseAction,
  deleteErrorLessonAction,
  deleteKnowledgeBaseAction,
  deleteTuningDocAction,
  generateTuningImageAction,
  getTuningStateAction,
  resetTuningSignalsAction,
  retryTuningDocAction,
  setTuningPrefsAction,
  submitTuningFeedbackAction,
  updateErrorLessonStatusAction,
  uploadTuningPdfsAction,
} from "@/lib/actions/tuning";
import type { TuningDocStatus } from "@/lib/db/schema";

/* ── Human-readable pipeline status (mirrors real worker stages) ── */
const STATUS_LABEL: Record<TuningDocStatus, string> = {
  uploaded: "Uploaded",
  queued: "Waiting to process",
  reading: "Reading document",
  chunking: "Analyzing concepts",
  indexing: "Building knowledge index",
  patterns: "Building knowledge patterns",
  ready: "Ready",
  failed: "Failed",
};

const TERMINAL: TuningDocStatus[] = ["ready", "failed"];

type KbDoc = {
  id: string;
  kbId: string;
  fileName: string;
  sizeBytes: number;
  charCount: number;
  chunkCount: number;
  status: TuningDocStatus;
  progress: number;
  error: string | null;
  createdAt: string | null;
};

type Kb = {
  id: string;
  name: string;
  subjectId: string | null;
  status: string;
  docCount: number;
  readyDocCount: number;
  conceptCount: number;
  embeddingSource: string;
  lastProcessedAt: string | null;
  profile: {
    coreConcepts: { term: string; count: number; docs: number }[];
    definitions: { term: string; text: string }[];
    relationships: { from: string; to: string; weight: number }[];
    topicTree: { title: string; chunks: number }[];
    questionPatterns: { sample: string; count: number };
    terminologyNotes: string[];
    summary: string;
  };
  docs: KbDoc[];
};

type State = {
  bases: Kb[];
  subjects: { id: string; name: string }[];
  detailLevel: "short" | "medium" | "detailed";
  embeddingAvailable: boolean;
  learned: { visual: string | null; detail: string | null };
  improvements?: {
    id: string;
    kbId: string | null;
    topic: string | null;
    errorType: string;
    preventionRule: string;
    confidence: string;
    status: string;
    occurrenceCount: number;
  }[];
};

type Answer = {
  markdown: string;
  mermaid: string | null;
  conceptMap: { nodes: string[]; edges: { from: string; to: string }[] } | null;
  activityGraph: { label: string; minutes: number }[] | null;
  tunedCoverage: boolean;
  sourcesUsed: string[];
  kbName: string | null;
  kbId: string | null;
  llm: boolean;
  lessonsApplied?: number;
};

/* ── Minimal markdown renderer for tuned answers ── */
function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`"))
      return (
        <code key={i} className="rounded bg-muted px-1 py-0.5 text-[12px]">
          {p.slice(1, -1)}
        </code>
      );
    if (p.startsWith("_") && p.endsWith("_") && p.length > 2) return <em key={i}>{p.slice(1, -1)}</em>;
    return <React.Fragment key={i}>{p}</React.Fragment>;
  });
}

function TuningMarkdown({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = text.split("\n");
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith("```")) {
        buf.push(lines[i]!);
        i++;
      }
      i++;
      blocks.push(
        <div key={key++} className="neo-inset-sm overflow-hidden rounded-xl bg-muted/40">
          <p className="border-b border-border/60 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {lang === "mermaid" ? "Structured diagram (exact, editable spec)" : lang || "Code"}
          </p>
          <pre className="overflow-x-auto p-3 font-mono text-[12px] leading-relaxed">{buf.join("\n")}</pre>
        </div>,
      );
      continue;
    }
    if (/^\|.*\|\s*$/.test(line.trim()) && i + 1 < lines.length && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1]!.trim())) {
      const rows: string[][] = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i]!.trim())) {
        if (!/^‌/.test(lines[i]!)) rows.push(lines[i]!.trim().slice(1, -1).split("|").map((c) => c.trim()));
        i++;
      }
      const [head, , ...body] = rows;
      blocks.push(
        <div key={key++} className="overflow-x-auto rounded-xl border border-border/60">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-muted/50">
                {head!.map((h, ci) => (
                  <th key={ci} className="px-3 py-2 text-left font-semibold">
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri} className="border-t border-border/60">
                  {r.map((c, ci) => (
                    <td key={ci} className="px-3 py-2 align-top text-muted-foreground">
                      {renderInline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (line.trim().startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith(">")) {
        buf.push(lines[i]!.trim().replace(/^>\s?/, ""));
        i++;
      }
      blocks.push(
        <blockquote key={key++} className="space-y-1 border-l-2 border-primary/60 pl-3 text-[13px] leading-relaxed">
          {buf.map((b, bi) => (
            <p key={bi}>{renderInline(b)}</p>
          ))}
        </blockquote>,
      );
      continue;
    }
    if (/^(\d+[.)]|[-*])\s+/.test(line.trim())) {
      const buf: string[] = [];
      while (i < lines.length && /^(\d+[.)]|[-*])\s+/.test(lines[i]!.trim())) {
        buf.push(lines[i]!.trim().replace(/^(\d+[.)]|[-*])\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={key++} className="list-disc space-y-1 pl-5 text-[13px] leading-relaxed">
          {buf.map((b, bi) => (
            <li key={bi}>{renderInline(b)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    blocks.push(
      <p key={key++} className="text-[13.5px] leading-relaxed">
        {renderInline(line)}
      </p>,
    );
    i++;
  }
  return <div className="space-y-3">{blocks}</div>;
}

/* ── SVG concept map (structured, responsive, no image model needed) ── */
function ConceptMapSvg({ nodes, edges }: { nodes: string[]; edges: { from: string; to: string }[] }) {
  const shown = nodes.slice(0, 8);
  const W = 560;
  const H = Math.max(220, 90 + shown.length * 34);
  const pos = new Map<string, { x: number; y: number }>();
  shown.forEach((n, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    pos.set(n, { x: col === 0 ? 120 : W - 120, y: 50 + row * ((H - 80) / Math.max(1, Math.ceil(shown.length / 2) - 1 || 1)) });
  });
  if (shown.length === 1) pos.set(shown[0]!, { x: W / 2, y: H / 2 });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-xl" role="img" aria-label="Concept map">
      {edges
        .filter((e) => pos.has(e.from) && pos.has(e.to))
        .slice(0, 12)
        .map((e, i) => {
          const a = pos.get(e.from)!;
          const b = pos.get(e.to)!;
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--color-primary)" strokeOpacity="0.45" strokeWidth="1.5" />;
        })}
      {shown.map((n) => {
        const p = pos.get(n)!;
        return (
          <g key={n}>
            <rect x={p.x - 88} y={p.y - 17} width={176} height={34} rx={10} fill="var(--color-card)" stroke="var(--color-primary)" strokeOpacity="0.55" />
            <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="11.5" fontWeight="600" fill="var(--color-foreground)">
              {n.length > 24 ? `${n.slice(0, 23)}…` : n}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function ActivityBars({ data }: { data: { label: string; minutes: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.minutes));
  return (
    <div className="neo-inset-sm rounded-xl bg-muted/30 p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Measured study minutes</p>
      <div className="flex h-24 items-end gap-2">
        {data.map((d) => (
          <div key={d.label} className="flex flex-1 flex-col items-center gap-1">
            <div
              className="w-full rounded-t-md bg-primary/80"
              style={{ height: `${Math.max(4, (d.minutes / max) * 88)}px` }}
              title={`${d.label}: ${d.minutes} min`}
            />
            <span className="text-[10px] text-muted-foreground">{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(file);
  });
}

export function TuningDashboard({ initial }: { initial: State }) {
  const [state, setState] = React.useState<State>(initial);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [newSubject, setNewSubject] = React.useState("");
  const [uploading, setUploading] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const [askKb, setAskKb] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [asking, setAsking] = React.useState(false);
  const [answer, setAnswer] = React.useState<Answer | null>(null);
  const [imgPrompt, setImgPrompt] = React.useState("");
  const [imgBusy, setImgBusy] = React.useState(false);
  const [imgUrl, setImgUrl] = React.useState<string | null>(null);
  const [lastQuery, setLastQuery] = React.useState("");
  const [correction, setCorrection] = React.useState("");
  const [feedbackBusy, setFeedbackBusy] = React.useState(false);
  const [showCorrection, setShowCorrection] = React.useState(false);

  // Refresh from the server (each fetch also nudges the background pump).
  const refresh = React.useCallback(async () => {
    try {
      const s = await getTuningStateAction();
      setState(s as State);
    } catch {
      /* offline moment — keep last state */
    }
  }, []);

  // Poll while anything is still processing: a subscription to the job
  // queue's external progress, not a render cascade. Stops at terminal
  // states, skips hidden tabs (no background churn), and refreshes
  // immediately when the tab becomes visible again.
  const busy = state.bases.some((b) => b.docs.some((d) => !TERMINAL.includes(d.status)));
  React.useEffect(() => {
    if (!busy) return;
    const tick = () => {
      if (document.hidden) return;
      void refresh();
    };
    const t = setInterval(tick, 3000);
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [busy, refresh]);

  const createKb = async () => {
    if (!newName.trim()) {
      setNotice("Name your knowledge base first — e.g. Machine Learning.");
      return;
    }
    setCreating(true);
    const r = await createKnowledgeBaseAction({ name: newName.trim(), subjectId: newSubject || undefined });
    setCreating(false);
    if (!r.ok) {
      setNotice(r.error);
      return;
    }
    setNewName("");
    setNewSubject("");
    setNotice(null);
    await refresh();
  };

  const uploadFiles = async (kbId: string, files: FileList | File[]) => {
    const list = [...files].filter((f) => f.size > 0);
    if (!list.length) return;
    setUploading(true);
    setNotice(null);
    try {
      const payload = [];
      for (const f of list.slice(0, 10)) {
        payload.push({
          fileName: f.name,
          mimeType: f.type || "application/pdf",
          sizeBytes: f.size,
          dataBase64: await fileToBase64(f),
        });
      }
      const r = await uploadTuningPdfsAction({ kbId, files: payload });
      const bits: string[] = [];
      if (r.accepted.length) bits.push(`${r.accepted.length} PDF${r.accepted.length === 1 ? "" : "s"} queued — analysis runs in the background, you can leave this page.`);
      for (const s of r.skipped) bits.push(`${s.fileName}: ${s.reason}`);
      if (r.error && !r.accepted.length) bits.push(r.error);
      setNotice(bits.join(" ") || null);
      await refresh();
    } catch {
      setNotice("Upload failed — check the file and try again.");
    } finally {
      setUploading(false);
    }
  };

  const ask = async () => {
    if (!query.trim() || asking) return;
    setAsking(true);
    setAnswer(null);
    setImgUrl(null);
    setLastQuery(query.trim());
    setCorrection("");
    setShowCorrection(false);
    const r = await askTuningAction({ kbId: askKb || null, query: query.trim() });
    setAsking(false);
    if (!r.ok) {
      setNotice(r.error);
      return;
    }
    setAnswer(r as Answer);
  };

  const sendFeedback = async (rating: "correct" | "needs_correction") => {
    if (!answer || feedbackBusy) return;
    if (rating === "needs_correction" && !showCorrection) {
      setShowCorrection(true);
      return;
    }
    setFeedbackBusy(true);
    const r = await submitTuningFeedbackAction({
      kbId: answer.kbId,
      query: lastQuery || query.trim(),
      answer: answer.markdown.slice(0, 4000),
      rating,
      correction: correction.trim(),
    });
    setFeedbackBusy(false);
    if (!r.ok) {
      setNotice(r.error);
      return;
    }
    if (rating === "correct") {
      setNotice("Thanks — noted as correct.");
    } else if ("learned" in r && r.learned) {
      setNotice(`Learned — this correction (${r.confidence} confidence) will help similar future questions.`);
      setShowCorrection(false);
      setCorrection("");
      await refresh();
    } else if ("reason" in r && r.reason) {
      setNotice(r.reason as string);
      setShowCorrection(false);
      await refresh();
    }
  };

  const illustrate = async () => {
    const prompt = imgPrompt.trim() || query.trim();
    if (!prompt || imgBusy) return;
    setImgBusy(true);
    const r = await generateTuningImageAction({ prompt, kbId: askKb || null });
    setImgBusy(false);
    if (!r.ok) {
      setNotice(r.error);
      return;
    }
    setImgUrl(r.url);
  };

  return (
    <div className="rise-3d space-y-6">
      {notice && (
        <div className="neo-raise flex items-start gap-2.5 rounded-2xl bg-card p-4 text-[13px] leading-relaxed">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="flex-1">{notice}</p>
          <button onClick={() => setNotice(null)} aria-label="Dismiss" className="cursor-pointer text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Preferences row */}
      <Card>
        <CardBody className="flex flex-wrap items-center gap-3">
          <p className="text-[13px] font-semibold">Answer depth</p>
          <div className="neo-inset-sm flex rounded-xl bg-muted/40 p-1" role="group" aria-label="Preferred answer depth">
            {(["short", "medium", "detailed"] as const).map((d) => (
              <button
                key={d}
                onClick={() => void setTuningPrefsAction({ detailLevel: d }).then(refresh)}
                className={cn(
                  "cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition-all",
                  state.detailLevel === d ? "neo-raise-sm bg-card text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {d}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {state.embeddingAvailable ? "Provider embeddings when reachable, on-device index otherwise." : "On-device semantic index active — no AI key needed for retrieval."}
          </p>
          {(state.learned.visual || state.learned.detail) && (
            <p className="w-full text-xs text-muted-foreground">
              Learned from repeated use:{" "}
              {[state.learned.visual ? `${state.learned.visual.replace(/_/g, " ")} visuals` : null, state.learned.detail ? `${state.learned.detail} answers` : null]
                .filter(Boolean)
                .join(" · ")}
              .{" "}
              <button
                onClick={() => void resetTuningSignalsAction().then(refresh)}
                className="cursor-pointer font-semibold text-primary underline-offset-2 hover:underline"
              >
                Reset learned preferences
              </button>
            </p>
          )}
        </CardBody>
      </Card>

      {/* Create / select */}
      <Card className="neo-extrude bevel-top">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-4 w-4 text-muted-foreground" /> Knowledge bases
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New subject space — e.g. Machine Learning"
              maxLength={80}
              className="neo-inset-sm h-10 flex-1 rounded-xl bg-muted/40 px-3 text-sm outline-none placeholder:text-muted-foreground/70"
            />
            <select
              value={newSubject}
              onChange={(e) => setNewSubject(e.target.value)}
              className="neo-inset-sm h-10 rounded-xl bg-muted/40 px-3 text-sm text-foreground outline-none"
              aria-label="Link to a syllabus subject (optional)"
            >
              <option value="">Standalone (no subject link)</option>
              {state.subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <Button onClick={createKb} disabled={creating} className="gap-1.5">
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create
            </Button>
          </div>

          {state.bases.length === 0 && (
            <p className="rounded-xl border border-dashed border-border/70 px-4 py-6 text-center text-[13px] text-muted-foreground">
              No knowledge bases yet. Create one above, upload its PDFs, and Tuning starts learning your material.
            </p>
          )}

          {state.bases.map((kb) => (
            <div key={kb.id} className="neo-raise rounded-2xl bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-display text-[16px] font-bold">{kb.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {kb.readyDocCount === kb.docCount && kb.docCount > 0
                      ? `${kb.docCount} study document${kb.docCount === 1 ? "" : "s"} analyzed · Knowledge base ready`
                      : kb.docCount === 0
                        ? "No documents yet — upload its PDFs below"
                        : `${kb.readyDocCount} of ${kb.docCount} documents ready · ${kb.conceptCount} concepts indexed`}
                    {kb.lastProcessedAt ? ` · updated ${new Date(kb.lastProcessedAt).toLocaleDateString()}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={kb.readyDocCount === kb.docCount && kb.docCount > 0 ? "success" : kb.docCount === 0 ? "neutral" : "warning"}>
                    {kb.readyDocCount === kb.docCount && kb.docCount > 0 ? "Ready" : kb.docCount === 0 ? "Empty" : "Building"}
                  </Badge>
                  <button
                    onClick={() => void deleteKnowledgeBaseAction(kb.id).then(refresh)}
                    aria-label={`Delete ${kb.name}`}
                    className="cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:bg-danger-soft hover:text-danger"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {kb.profile.summary && <p className="mt-3 text-[13px] italic leading-relaxed text-muted-foreground">{kb.profile.summary}</p>}

              {kb.profile.coreConcepts.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {kb.profile.coreConcepts.slice(0, 10).map((c) => (
                    <span key={c.term} className="neo-inset-sm rounded-full bg-muted/40 px-2.5 py-1 text-[11px] font-medium" title={`in ${c.count} passages · ${c.docs} documents`}>
                      {c.term} · {c.count}
                    </span>
                  ))}
                </div>
              )}

              {kb.profile.topicTree.length > 0 && (
                <div className="mt-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Detected structure</p>
                  <ul className="mt-1.5 space-y-1">
                    {kb.profile.topicTree.slice(0, 5).map((t) => (
                      <li key={t.title} className="flex items-center gap-2 text-[13px]">
                        <BookOpen className="h-3.5 w-3.5 shrink-0 text-primary" />
                        <span className="font-medium">{t.title}</span>
                        <span className="text-xs text-muted-foreground">{t.chunks} passages</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {kb.profile.terminologyNotes.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {kb.profile.terminologyNotes.map((n, i) => (
                    <li key={i} className="text-xs leading-relaxed text-muted-foreground">• {n}</li>
                  ))}
                </ul>
              )}

              {/* Upload zone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  void uploadFiles(kb.id, e.dataTransfer.files);
                }}
                className={cn(
                  "mt-4 flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition-all",
                  dragOver ? "border-primary bg-primary-soft/40" : "border-border/70 hover:border-primary/50",
                )}
                onClick={() => document.getElementById(`tuning-file-${kb.id}`)?.click()}
                role="button"
                tabIndex={0}
                aria-label={`Upload PDFs to ${kb.name}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter") document.getElementById(`tuning-file-${kb.id}`)?.click();
                }}
              >
                <UploadCloud className="h-6 w-6 text-primary" />
                <p className="text-[13px] font-semibold">Drop PDFs here or click to choose (up to 10 at once, 100 MB each)</p>
                <p className="text-xs text-muted-foreground">Processing runs in the background — you can leave this page.</p>
                <input
                  id={`tuning-file-${kb.id}`}
                  type="file"
                  accept="application/pdf,.pdf"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.length) void uploadFiles(kb.id, e.target.files);
                    e.target.value = "";
                  }}
                />
              </div>
              {uploading && (
                <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…
                </p>
              )}

              {/* Documents — layout animates when Uploaded → … → Ready */}
              {kb.docs.length > 0 && (
                <motion.ul layout className="mt-3 space-y-2">
                  <AnimatePresence initial={false}>
                  {kb.docs.map((d) => (
                    <motion.li
                      key={d.id}
                      variants={listItem}
                      initial="hidden"
                      animate="show"
                      exit="exit"
                      layout
                      className="neo-inset-sm rounded-xl bg-muted/30 px-3 py-2.5"
                    >
                      <div className="flex items-center gap-2.5">
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium">{d.fileName}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {STATUS_LABEL[d.status]}
                            {d.status === "ready" ? ` · ${d.chunkCount} passages` : ` · ${d.progress}%`}
                            {d.error ? ` — ${d.error}` : ""}
                          </p>
                        </div>
                        {d.status === "ready" ? (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                        ) : d.status === "failed" ? (
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              onClick={() => void retryTuningDocAction(d.id).then(refresh)}
                              className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-card px-2 py-1 text-[11px] font-semibold text-primary shadow-raise-sm"
                            >
                              <RefreshCw className="h-3 w-3" /> Retry
                            </button>
                            <button
                              onClick={() => void deleteTuningDocAction(d.id).then(refresh)}
                              aria-label={`Delete ${d.fileName}`}
                              className="cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:text-danger"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                        )}
                      </div>
                      {!TERMINAL.includes(d.status) && (
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={d.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`${d.fileName} processing`}>
                          <div className="bar-grow h-full rounded-full bg-primary transition-all" style={{ width: `${d.progress}%` }} />
                        </div>
                      )}
                    </motion.li>
                  ))}
                  </AnimatePresence>
                </motion.ul>
              )}
            </div>
          ))}
        </CardBody>
      </Card>

      {/* Ask tuned AI */}
      <Card className="bevel-top">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="h-4 w-4 text-muted-foreground" /> Ask your tuned AI
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              value={askKb}
              onChange={(e) => setAskKb(e.target.value)}
              className="neo-inset-sm h-10 rounded-xl bg-muted/40 px-3 text-sm outline-none sm:w-64"
              aria-label="Subject context (auto-detect by default)"
            >
              <option value="">Auto-detect subject</option>
              {state.bases.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <div className="neo-inset-sm flex h-11 flex-1 items-center gap-2 rounded-xl bg-muted/40 px-3">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void ask();
                }}
                placeholder="Explain entropy… compare BFS vs DFS… flowchart of TCP handshake…"
                maxLength={1000}
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
              />
              <button
                onClick={ask}
                disabled={asking || !query.trim()}
                aria-label="Ask"
                className="tactile neo-raise-sm flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40"
              >
                {asking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {answer && (
            <div className="neo-raise space-y-4 rounded-2xl bg-card p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={answer.tunedCoverage ? "success" : "warning"}>
                  {answer.tunedCoverage ? `Tuned · ${answer.kbName ?? "materials"}` : "Beyond uploads"}
                </Badge>
                {answer.llm && <Badge tone="primary">AI prose</Badge>}
                {!answer.llm && answer.tunedCoverage && <Badge tone="neutral">On-device answer</Badge>}
                {answer.sourcesUsed.length > 0 && (
                  <span className="text-[11px] text-muted-foreground">Sources: {answer.sourcesUsed.slice(0, 4).join(", ")}</span>
                )}
              </div>
              <TuningMarkdown text={answer.markdown} />
              {/* Lightweight feedback: ✓ / ⚠ — never forced, never blocks. */}
              <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
                {answer.lessonsApplied ? (
                  <span className="text-[11px] text-muted-foreground">
                    {answer.lessonsApplied} learned improvement{answer.lessonsApplied === 1 ? "" : "s"} applied
                  </span>
                ) : null}
                <span className="text-[11px] text-muted-foreground">Was this right?</span>
                <button
                  onClick={() => void sendFeedback("correct")}
                  disabled={feedbackBusy}
                  className="cursor-pointer rounded-lg bg-card px-2.5 py-1 text-[11px] font-semibold text-success shadow-raise-sm disabled:opacity-40"
                >
                  ✓ Correct
                </button>
                <button
                  onClick={() => void sendFeedback("needs_correction")}
                  disabled={feedbackBusy}
                  className="cursor-pointer rounded-lg bg-card px-2.5 py-1 text-[11px] font-semibold text-warning shadow-raise-sm disabled:opacity-40"
                >
                  ⚠ Needs correction
                </button>
              </div>
              {showCorrection && (
                <div className="flex flex-col gap-2">
                  <input
                    value={correction}
                    onChange={(e) => setCorrection(e.target.value)}
                    placeholder="What should be corrected? e.g. The uploaded material says X…"
                    maxLength={1000}
                    className="neo-inset-sm h-9 flex-1 rounded-xl bg-muted/40 px-3 text-[13px] outline-none placeholder:text-muted-foreground/70"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => void sendFeedback("needs_correction")}
                      disabled={feedbackBusy || !correction.trim()}
                      className="cursor-pointer rounded-lg bg-primary px-3 py-1.5 text-[12px] font-semibold text-primary-foreground disabled:opacity-40"
                    >
                      {feedbackBusy ? "Learning…" : "Teach this correction"}
                    </button>
                    <button
                      onClick={() => setShowCorrection(false)}
                      className="cursor-pointer rounded-lg px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {answer.conceptMap && answer.conceptMap.nodes.length > 1 && (
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Concept map</p>
                  <ConceptMapSvg nodes={answer.conceptMap.nodes} edges={answer.conceptMap.edges} />
                </div>
              )}
              {answer.activityGraph && <ActivityBars data={answer.activityGraph} />}
              <div className="flex flex-col gap-2 border-t border-border/60 pt-3 sm:flex-row">
                <input
                  value={imgPrompt}
                  onChange={(e) => setImgPrompt(e.target.value)}
                  placeholder="Describe an illustration (optional)…"
                  maxLength={300}
                  className="neo-inset-sm h-9 flex-1 rounded-xl bg-muted/40 px-3 text-[13px] outline-none placeholder:text-muted-foreground/70"
                />
                <button
                  onClick={illustrate}
                  disabled={imgBusy}
                  className={cn(variantClasses.outline, sizeClasses.sm, "inline-flex cursor-pointer items-center gap-1.5")}
                >
                  {imgBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />} Illustrate
                </button>
              </div>
              {imgUrl && (
                <div className="overflow-hidden rounded-xl border border-border/60">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imgUrl} alt="AI-generated illustration" className="w-full" />
                </div>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Learned Improvements — user-scoped prevention rules (view / disable / delete). */}
      {(state.improvements ?? []).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-muted-foreground" /> Learned improvements
            </CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            {(state.improvements ?? []).slice(0, 10).map((imp) => (
              <div key={imp.id} className="neo-inset-sm rounded-xl bg-muted/30 px-3 py-2.5">
                <p className="text-[13px] leading-relaxed">✓ {imp.preventionRule}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {imp.errorType.replace(/_/g, " ")} · {imp.confidence} confidence
                  {imp.topic ? ` · ${imp.topic}` : ""}
                  {imp.occurrenceCount > 1 ? ` · seen ${imp.occurrenceCount}×` : ""}
                  {imp.status !== "active" ? ` · ${imp.status.replace(/_/g, " ")}` : ""}
                </p>
                <div className="mt-1.5 flex gap-2">
                  {imp.status === "active" ? (
                    <button
                      onClick={() => void updateErrorLessonStatusAction({ id: imp.id, status: "disabled" }).then(refresh)}
                      className="cursor-pointer text-[11px] font-semibold text-muted-foreground hover:text-foreground"
                    >
                      Disable
                    </button>
                  ) : imp.status === "disabled" ? (
                    <button
                      onClick={() => void updateErrorLessonStatusAction({ id: imp.id, status: "active" }).then(refresh)}
                      className="cursor-pointer text-[11px] font-semibold text-primary hover:underline"
                    >
                      Re-enable
                    </button>
                  ) : null}
                  <button
                    onClick={() => void deleteErrorLessonAction(imp.id).then(refresh)}
                    className="cursor-pointer text-[11px] font-semibold text-muted-foreground hover:text-danger"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
