"use client";

import * as React from "react";
import { ImagePlus, Loader2, PenLine, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StudyMaterialInput } from "./study-material-input";
import {
  evaluateSummaryImageAction,
  evaluateSummaryTextAction,
  generateSummaryPromptAction,
} from "@/lib/actions/assess";
import type { SummaryEvaluation } from "@/lib/assess/summary";

type Band = "Strong" | "Good" | "Needs improvement";

function bandTone(b: Band): "success" | "primary" | "warning" {
  return b === "Strong" ? "success" : b === "Good" ? "primary" : "warning";
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(((r.result as string) ?? "").split(",")[1] ?? "");
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(file);
  });
}

const SUMMARY_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const SUMMARY_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export function SummaryRunner({ subjectId }: { subjectId?: string }) {
  const [material, setMaterial] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [attemptId, setAttemptId] = React.useState<string | null>(null);
  const [prompt, setPrompt] = React.useState<string | null>(null);
  const [keyPoints, setKeyPoints] = React.useState<string[]>([]);

  const [tab, setTab] = React.useState<"write" | "upload">("write");
  const [answer, setAnswer] = React.useState("");
  const [image, setImage] = React.useState<{ file: File; preview: string } | null>(null);
  const [evaluating, setEvaluating] = React.useState(false);
  const [evaluation, setEvaluation] = React.useState<SummaryEvaluation | null>(null);
  const imgRef = React.useRef<HTMLInputElement>(null);

  const makePrompt = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await generateSummaryPromptAction({ material, subjectId });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setAttemptId(r.attemptId);
      setPrompt(r.prompt);
      setKeyPoints(r.keyPoints);
      setEvaluation(null);
      setAnswer("");
      setImage(null);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setAttemptId(null);
    setPrompt(null);
    setEvaluation(null);
    setError(null);
  };

  const submitText = async () => {
    if (!attemptId || evaluating) return;
    setEvaluating(true);
    setError(null);
    try {
      const r = await evaluateSummaryTextAction({ attemptId, answer });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setEvaluation(r.evaluation);
    } finally {
      setEvaluating(false);
    }
  };

  const submitImage = async () => {
    if (!attemptId || !image || evaluating) return;
    setEvaluating(true);
    setError(null);
    try {
      const base64 = await readAsBase64(image.file);
      const r = await evaluateSummaryImageAction({ attemptId, imageBase64: base64, mimeType: image.file.type });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setEvaluation(r.evaluation);
    } catch {
      setError("Could not read that image. Try again.");
    } finally {
      setEvaluating(false);
    }
  };

  const onPickImage = (file: File | undefined) => {
    if (!file) return;
    if (!SUMMARY_IMAGE_MIMES.has(file.type)) {
      setError("Unsupported image format — use JPEG, PNG or WebP.");
      return;
    }
    if (file.size <= 0) {
      setError("The image is empty.");
      return;
    }
    if (file.size > SUMMARY_IMAGE_MAX_BYTES) {
      setError("Image is too large — the limit is 5 MB.");
      return;
    }
    if (image?.preview) URL.revokeObjectURL(image.preview);
    setError(null);
    setImage({ file, preview: URL.createObjectURL(file) });
    setEvaluation(null);
  };

  React.useEffect(() => () => {
    if (image?.preview) URL.revokeObjectURL(image.preview);
  }, [image?.preview]);

  if (evaluation) {
    const e = evaluation;
    return (
      <div className="rise-3d space-y-4">
        <Card className="neo-extrude bevel-top">
          <CardBody className="space-y-3 pt-5">
            <div className="flex flex-wrap items-center gap-3">
              <p className="font-display text-4xl font-bold tabular-nums">{e.score}</p>
              <span className="text-sm text-muted-foreground">/ 100</span>
              <Badge tone={e.score >= 80 ? "success" : e.score >= 55 ? "warning" : "danger"}>{e.overallAssessment}</Badge>
            </div>
            <div className="neo-inset-sm h-3 overflow-hidden rounded-full bg-muted/50">
              <div className="bar-grow h-full rounded-full bg-primary" style={{ width: `${e.score}%` }} />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(
                [
                  ["Understanding", e.understanding],
                  ["Completeness", e.completeness],
                  ["Accuracy", e.accuracy],
                  ["Clarity", e.clarity],
                ] as [string, Band][]
              ).map(([label, band]) => (
                <div key={label} className="neo-inset-sm rounded-xl bg-muted/30 px-3 py-2 text-center">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                  <Badge tone={bandTone(band)} className="mt-1">
                    {band}
                  </Badge>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>What you got right</CardTitle>
          </CardHeader>
          <CardBody>
            {e.correctPoints.length ? (
              <ul className="list-disc space-y-1.5 pl-5 text-[13.5px] leading-relaxed">
                {e.correctPoints.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted-foreground">Nothing to credit yet — the next attempt is where it starts.</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Important points you missed</CardTitle>
          </CardHeader>
          <CardBody>
            {e.missingPoints.length ? (
              <ul className="list-disc space-y-1.5 pl-5 text-[13.5px] leading-relaxed">
                {e.missingPoints.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted-foreground">Full coverage — nothing important left out.</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Mistakes to correct</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            {e.mistakes.length ? (
              e.mistakes.map((m, i) => (
                <div key={i} className="neo-inset-sm rounded-xl bg-danger-soft/30 p-3.5 text-[13px] leading-relaxed">
                  <p>
                    <span className="font-semibold">You wrote: </span>“{m.statement}”
                  </p>
                  <p className="mt-1.5">
                    <span className="font-semibold">Why it is off: </span>
                    {m.explanation}
                  </p>
                  <p className="mt-1.5">
                    <span className="font-semibold">Correction: </span>
                    {m.correction}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-[13px] text-muted-foreground">No factual or conceptual mistakes found.</p>
            )}
          </CardBody>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>How to improve</CardTitle>
            </CardHeader>
            <CardBody>
              <ul className="list-disc space-y-1.5 pl-5 text-[13.5px] leading-relaxed">
                {e.improvementSuggestions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Structure and presentation</CardTitle>
            </CardHeader>
            <CardBody>
              <ul className="list-disc space-y-1.5 pl-5 text-[13.5px] leading-relaxed">
                {e.representationFeedback.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>

        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle>Suggested improved answer</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="text-[13.5px] leading-relaxed text-muted-foreground">
              One strong example — grounded in your material, not the only valid answer.
            </p>
            <p className="mt-2 whitespace-pre-line text-[13.5px] leading-relaxed">{e.suggestedImprovedAnswer}</p>
          </CardBody>
        </Card>

        <Button onClick={reset} variant="outline" className="gap-1.5">
          <RotateCcw className="h-4 w-4" /> Practice again
        </Button>
      </div>
    );
  }

  if (!attemptId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PenLine className="h-4 w-4 text-muted-foreground" /> Summary Practice
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            Get a descriptive question from your material, answer in your own words — typed or handwritten — and receive
            structured evaluation.
          </p>
          <StudyMaterialInput value={material} onChange={setMaterial} id="summary-material" />
          {error && <p className="text-[13px] text-danger">{error}</p>}
          <Button onClick={makePrompt} loading={busy} disabled={busy} className="w-full sm:w-auto">
            {busy ? "Reading your material…" : "Create my question"}
          </Button>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-primary/40">
        <CardBody className="space-y-1 pt-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Your question</p>
          <p className="text-[15px] font-semibold leading-relaxed">{prompt}</p>
          {keyPoints.length > 0 && (
            <p className="text-xs text-muted-foreground">A strong answer touches: {keyPoints.slice(0, 4).join(" · ")}</p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-3 pt-5">
          <div className="neo-inset-sm flex w-fit rounded-xl bg-muted/40 p-1" role="tablist" aria-label="Answer input">
            {(["write", "upload"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => {
                  setTab(t);
                  setError(null);
                }}
                className={cn(
                  "cursor-pointer rounded-lg px-4 py-1.5 text-xs font-semibold capitalize transition-all",
                  tab === t ? "neo-raise-sm bg-card text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t === "write" ? "Write answer" : "Upload image"}
              </button>
            ))}
          </div>

          {tab === "write" ? (
            <>
              <textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                rows={8}
                maxLength={4200}
                placeholder="Write your answer here in your own words…"
                className="neo-inset-sm w-full resize-y rounded-2xl bg-muted/40 px-4 py-3 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/70 focus:ring-2 focus:ring-ring"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs tabular-nums text-muted-foreground">{answer.trim().length} chars (min 20)</span>
                <Button onClick={submitText} loading={evaluating} disabled={evaluating || !answer.trim()}>
                  {evaluating ? "Checking your answer…" : "Submit for evaluation"}
                </Button>
              </div>
            </>
          ) : (
            <>
              <input
                ref={imgRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                className="hidden"
                aria-label="Upload a photo of your handwritten answer"
                onChange={(e) => onPickImage(e.target.files?.[0])}
              />
              {!image ? (
                <button
                  type="button"
                  onClick={() => imgRef.current?.click()}
                  className="flex w-full cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-border/70 px-4 py-8 text-center transition-colors hover:border-primary/50"
                >
                  <ImagePlus className="h-6 w-6 text-primary" />
                  <span className="text-[13px] font-semibold">Photograph your handwritten answer</span>
                  <span className="text-xs text-muted-foreground">JPEG, PNG or WebP · up to 5 MB · camera works on mobile</span>
                </button>
              ) : (
                <div className="space-y-2">
                  <div className="overflow-hidden rounded-2xl border border-border/60">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image.preview} alt="Your handwritten answer preview" className="max-h-96 w-full object-contain bg-muted/30" />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={submitImage} loading={evaluating} disabled={evaluating}>
                      {evaluating ? "Reading your answer…" : "Submit photo for evaluation"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        if (image.preview) URL.revokeObjectURL(image.preview);
                        setImage(null);
                        if (imgRef.current) imgRef.current.value = "";
                      }}
                      className="gap-1.5"
                    >
                      <X className="h-4 w-4" /> Replace
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
          {evaluating && (
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {tab === "write" ? "Checking your answer against the study material…" : "Reading your uploaded answer…"}
            </p>
          )}
          {error && <p className="text-[13px] text-danger">{error}</p>}
        </CardBody>
      </Card>
    </div>
  );
}
