"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { GitFork, Minus, Plus, Sparkles, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingStages, useStagedBusy } from "@/components/motion/feedback";
import { branchReveal } from "@/components/motion/variants";
import { fast } from "@/components/motion/transitions";
import { SourceToggle, SyllabusScopePicker, useSyllabusTree } from "./study-source-picker";
import { deleteMindmapAction, generateMindMapAction, getMindmapsAction } from "@/lib/actions/study";
import type { MindMap } from "@/lib/assess/mindmaps";

type SavedMap = { id: string; title: string; sourceLabel: string; createdAt: string | null; map: MindMap };

/* NotebookLM-style mind map — a real tree: central topic with branches
   fanning left and right, curved connectors, HTML nodes (always
   readable, wrappable, selectable). Pan by scrolling, zoom by control. */

const BRANCH_ACCENTS = [
  { dot: "bg-violet-500", ring: "border-violet-500/50", text: "text-violet-700" },
  { dot: "bg-sky-500", ring: "border-sky-500/50", text: "text-sky-700" },
  { dot: "bg-amber-500", ring: "border-amber-500/50", text: "text-amber-700" },
  { dot: "bg-emerald-500", ring: "border-emerald-500/50", text: "text-emerald-700" },
  { dot: "bg-rose-500", ring: "border-rose-500/50", text: "text-rose-700" },
  { dot: "bg-cyan-500", ring: "border-cyan-500/50", text: "text-cyan-700" },
] as const;

const TREE = {
  centralW: 210,
  branchW: 200,
  leafW: 190,
  branchH: 60,
  leafH: 52,
  gapX: 80,
  gapY: 12,
  pad: 40,
};

type TreeNode = {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  detail: string;
  kind: "central" | "branch" | "leaf";
  branchIndex: number;
  collapsed?: boolean;
};

type TreeLink = { x1: number; y1: number; x2: number; y2: number };

/** Pure tree layout (exported for tests) — branches fan left/right of center. */
export function layoutTree(
  map: MindMap,
  collapsed: Set<string>,
): { nodes: TreeNode[]; links: TreeLink[]; width: number; height: number } {
  const nodes: TreeNode[] = [];
  const links: TreeLink[] = [];
  const right = map.branches.filter((_, i) => i % 2 === 0);
  const left = map.branches.filter((_, i) => i % 2 === 1);

  const kidsOf = (b: MindMap["branches"][number]) => (collapsed.has(b.label) ? [] : b.children);
  const blockH = (b: MindMap["branches"][number]) =>
    Math.max(TREE.branchH + TREE.gapY, kidsOf(b).length * (TREE.leafH + TREE.gapY));
  const stackH = (list: MindMap["branches"]) => list.reduce((s, b) => s + blockH(b), 0);
  const contentH = Math.max(stackH(right), stackH(left), 120);
  const height = contentH + TREE.pad * 2;

  const leafW = TREE.leafW;
  const leftLeafX = TREE.pad;
  const leftBranchX = leftLeafX + leafW + TREE.gapX;
  const centerX = leftBranchX + TREE.branchW + TREE.gapX;
  const rightBranchX = centerX + TREE.centralW + TREE.gapX;
  const rightLeafX = rightBranchX + TREE.branchW + TREE.gapX;
  const width = rightLeafX + leafW + TREE.pad;

  const centerY = height / 2 - TREE.branchH / 2;
  nodes.push({
    key: "__central",
    x: centerX,
    y: centerY,
    w: TREE.centralW,
    h: TREE.branchH,
    label: map.central,
    detail: "",
    kind: "central",
    branchIndex: -1,
  });

  const place = (list: MindMap["branches"], side: "left" | "right") => {
    let y = TREE.pad + (contentH - stackH(list)) / 2;
    for (const b of list) {
      const kids = kidsOf(b);
      const block = blockH(b);
      const by = y + block / 2 - TREE.branchH / 2;
      const branchIndex = map.branches.indexOf(b);
      const bx = side === "right" ? rightBranchX : leftBranchX;
      nodes.push({
        key: `b:${b.label}`,
        x: bx,
        y: by,
        w: TREE.branchW,
        h: TREE.branchH,
        label: b.label,
        detail: b.detail ?? "",
        kind: "branch",
        branchIndex,
        collapsed: collapsed.has(b.label),
      });
      // center -> branch
      if (side === "right") {
        links.push({ x1: centerX + TREE.centralW, y1: centerY + TREE.branchH / 2, x2: bx, y2: by + TREE.branchH / 2 });
      } else {
        links.push({ x1: centerX, y1: centerY + TREE.branchH / 2, x2: bx + TREE.branchW, y2: by + TREE.branchH / 2 });
      }
      kids.forEach((k, i) => {
        const ly = y + (block - kids.length * (TREE.leafH + TREE.gapY)) / 2 + i * (TREE.leafH + TREE.gapY);
        const lx = side === "right" ? rightLeafX : leftLeafX;
        nodes.push({
          key: `l:${b.label}:${k.label}`,
          x: lx,
          y: ly,
          w: leafW,
          h: TREE.leafH,
          label: k.label,
          detail: k.detail ?? "",
          kind: "leaf",
          branchIndex,
        });
        if (side === "right") {
          links.push({ x1: bx + TREE.branchW, y1: by + TREE.branchH / 2, x2: lx, y2: ly + TREE.leafH / 2 });
        } else {
          links.push({ x1: bx, y1: by + TREE.branchH / 2, x2: lx + leafW, y2: ly + TREE.leafH / 2 });
        }
      });
      y += block;
    }
  };
  place(right, "right");
  place(left, "left");

  return { nodes, links, width, height };
}

function connector(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(24, Math.abs(x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + (x2 > x1 ? dx : -dx)} ${y1}, ${x2 - (x2 > x1 ? dx : -dx)} ${y2}, ${x2} ${y2}`;
}

function MindMapView({ map, sourceLabel }: { map: MindMap; sourceLabel: string }) {
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const [zoom, setZoom] = React.useState(1);
  const layout = React.useMemo(() => layoutTree(map, collapsed), [map, collapsed]);

  const toggle = (label: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="primary">{sourceLabel}</Badge>
        {map.summary && <p className="text-[13px] text-muted-foreground">{map.summary}</p>}
        <span className="flex-1" />
        <div className="flex items-center gap-1" role="group" aria-label="Zoom">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}
            className="neo-raise-sm cursor-pointer rounded-lg bg-card p-2"
            aria-label="Zoom out"
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="w-12 text-center text-xs font-semibold tabular-nums">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(1.75, +(z + 0.25).toFixed(2)))}
            className="neo-raise-sm cursor-pointer rounded-lg bg-card p-2"
            aria-label="Zoom in"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="neo-inset-sm overflow-auto rounded-2xl bg-muted/20" style={{ maxHeight: "70vh" }} role="img" aria-label={`Mind map of ${map.central}`}>
        <div style={{ width: layout.width * zoom, height: layout.height * zoom }} className="relative max-w-none">
          <motion.div
            animate={{ scale: zoom }}
            transition={fast}
            style={{ width: layout.width, height: layout.height, transformOrigin: "top left" }}
            className="relative"
          >
            <svg width={layout.width} height={layout.height} className="absolute inset-0" aria-hidden>
              {layout.links.map((l, i) => (
                <path key={i} d={connector(l.x1, l.y1, l.x2, l.y2)} fill="none" stroke="currentColor" strokeOpacity={0.3} strokeWidth={2.5} />
              ))}
            </svg>
            <AnimatePresence>
            {layout.nodes.map((n) => {
              const accent = n.branchIndex >= 0 ? BRANCH_ACCENTS[n.branchIndex % BRANCH_ACCENTS.length]! : null;
              if (n.kind === "central") {
                return (
                  <motion.div
                    key={n.key}
                    layout
                    transition={fast}
                    style={{ left: n.x, top: n.y, width: n.w, minHeight: n.h }}
                    className="absolute flex items-center justify-center rounded-2xl bg-primary px-4 py-3 text-center shadow-lg"
                  >
                    <p className="text-[15px] font-bold leading-snug text-primary-foreground">{n.label}</p>
                  </motion.div>
                );
              }
              return (
                <motion.div
                  key={n.key}
                  variants={branchReveal}
                  initial="hidden"
                  animate="show"
                  exit="exit"
                  layout
                  transition={fast}
                  style={{ left: n.x, top: n.y, width: n.w, minHeight: n.h }}
                  title={n.detail || n.label}
                  className={cn("absolute rounded-xl border-2 bg-card px-3 py-2 shadow-sm", accent?.ring)}
                >
                  <div className="flex items-center gap-1.5">
                    <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", accent?.dot)} aria-hidden />
                    <p className={cn("flex-1 text-[13px] font-bold leading-snug", accent?.text)}>{n.label}</p>
                    {n.kind === "branch" && (
                      <button
                        type="button"
                        onClick={() => toggle(n.label)}
                        aria-expanded={!n.collapsed}
                        aria-label={n.collapsed ? `Expand ${n.label}` : `Collapse ${n.label}`}
                        className="cursor-pointer rounded-md px-1.5 text-base font-bold leading-none text-muted-foreground hover:text-foreground"
                      >
                        {n.collapsed ? "+" : "−"}
                      </button>
                    )}
                  </div>
                  {n.detail && n.kind === "branch" && <p className="mt-0.5 pl-4 text-[11px] text-muted-foreground">{n.detail}</p>}
                </motion.div>
              );
            })}
            </AnimatePresence>
          </motion.div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Branches fan out on both sides like a NotebookLM map — tap + / − to collapse, scroll to pan, zoom as needed.</p>
    </div>
  );
}

export function MindmapStudio() {
  const [source, setSource] = React.useState<"syllabus" | "general">("syllabus");
  const tree = useSyllabusTree();
  const [selSubjectRaw, setSelSubject] = React.useState("");
  const selSubject = selSubjectRaw || tree?.[0]?.id || "";
  const [selUnit, setSelUnit] = React.useState("");
  const [selTopic, setSelTopic] = React.useState("");
  const [prompt, setPrompt] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ map: MindMap; sourceLabel: string } | null>(null);
  const [saved, setSaved] = React.useState<SavedMap[] | null>(null);
  const mapStage = useStagedBusy(busy, ["Reading topic scope", "Finding concept relationships", "Laying out branches"]);

  React.useEffect(() => {
    let live = true;
    void getMindmapsAction().then((maps) => {
      if (live) setSaved(maps);
    });
    return () => {
      live = false;
    };
  }, []);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await generateMindMapAction({
        source,
        subjectId: source === "syllabus" ? selSubject || undefined : undefined,
        unitId: selUnit || undefined,
        topicId: selTopic || undefined,
        prompt: source === "general" ? prompt || undefined : undefined,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setResult({ map: r.map, sourceLabel: r.sourceLabel });
      setSaved(await getMindmapsAction());
    } finally {
      setBusy(false);
    }
  };

  const canStart = !busy && (source === "general" ? prompt.trim().length >= 3 : selSubject !== "");

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {result ? <GitFork className="h-4 w-4 text-muted-foreground" /> : <Sparkles className="h-4 w-4 text-muted-foreground" />}{" "}
            {result ? result.map.central : "New mind map"}
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          {!result ? (
            <>
              <SourceToggle value={source} onChange={setSource} />
              {source === "syllabus" ? (
                tree === null ? (
                  <p className="text-[13px] text-muted-foreground">Loading your syllabus…</p>
                ) : (
                  <SyllabusScopePicker
                    tree={tree}
                    subject={selSubject}
                    unit={selUnit}
                    topic={selTopic}
                    onSubject={(id) => {
                      setSelSubject(id);
                      setSelUnit("");
                      setSelTopic("");
                    }}
                    onUnit={(id) => {
                      setSelUnit(id);
                      setSelTopic("");
                    }}
                    onTopic={setSelTopic}
                  />
                )
              ) : (
                <label className="block space-y-1.5">
                  <span className="block text-xs font-semibold text-muted-foreground">Topic or question</span>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={3}
                    maxLength={500}
                    placeholder="What should the map explain? e.g. How TCP works…"
                    className="neo-inset-sm w-full resize-none rounded-2xl bg-muted/40 px-4 py-2.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/70 focus:ring-2 focus:ring-ring"
                  />
                </label>
              )}
              {error && <p className="text-[13px] text-danger" role="alert">{error}</p>}
              {busy && (
                <LoadingStages
                  stages={["Reading topic scope", "Finding concept relationships", "Laying out branches"]}
                  stageIndex={mapStage}
                  busyLabel="Organizing knowledge"
                />
              )}
              <Button onClick={generate} loading={busy} disabled={!canStart} className="w-full sm:w-auto">
                {busy ? "Organizing knowledge…" : "Generate mind map"}
              </Button>
            </>
          ) : (
            <>
              <MindMapView key={`${result.sourceLabel}:${result.map.central}`} map={result.map} sourceLabel={result.sourceLabel} />
              {error && <p className="text-[13px] text-danger">{error}</p>}
              <Button variant="outline" onClick={() => setResult(null)}>
                New mind map
              </Button>
            </>
          )}
        </CardBody>
      </Card>

      {saved !== null && saved.length > 0 && !result && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitFork className="h-4 w-4 text-muted-foreground" /> Saved mind maps ({saved.length})
            </CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="space-y-1.5">
              {saved.map((m) => (
                <li key={m.id} className="neo-inset-sm flex items-center gap-2 rounded-xl bg-muted/30 px-3 py-2 text-[13px]">
                  <button
                    type="button"
                    onClick={() => setResult({ map: m.map, sourceLabel: m.sourceLabel })}
                    className="flex-1 cursor-pointer text-left"
                  >
                    <span className="font-medium">{m.title}</span>
                    <span className="text-muted-foreground"> · {m.sourceLabel}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteMindmapAction(m.id).then(() => setSaved((s) => (s ?? []).filter((x) => x.id !== m.id)))}
                    aria-label={`Delete ${m.title}`}
                    className="cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:bg-danger-soft hover:text-danger"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
