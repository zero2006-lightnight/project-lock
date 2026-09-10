"use client";

import * as React from "react";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import type { WeekPoint, SubjectShare, DailyCell } from "@/lib/services/analytics";

type TooltipEntry = {
  name?: string | number;
  value?: string | number;
  color?: string;
  payload?: { fill?: string };
};

function ChartTooltip({
  active,
  payload,
  label,
  unit = "m",
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  unit?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="neo-float rounded-xl border border-border/50 bg-elevated px-3 py-2">
      <p className="text-xs font-semibold text-foreground">{label}</p>
      {payload.map((p: TooltipEntry, i: number) => (
        <p key={i} className="text-xs text-muted-foreground">
          <span style={{ color: p.color ?? p.payload?.fill }}>●</span>{" "}
          {p.name}: {Math.round(Number(p.value ?? 0))}
          {unit}
        </p>
      ))}
    </div>
  );
}

export function WeeklyBarChart({
  data,
  height = 180,
}: {
  data: WeekPoint[];
  height?: number;
}) {
  return (
    <div style={{ height }} aria-label="Weekly study minutes chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, left: -22, bottom: 0 }}>
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} />
          <Tooltip content={<ChartTooltip unit="m" />} cursor={{ fill: "var(--color-muted)" }} />
          <Bar dataKey="minutes" name="Studied" radius={[6, 6, 2, 2]} fill="var(--color-chart-1)" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SubjectDonut({
  data,
  height = 200,
}: {
  data: SubjectShare[];
  height?: number;
}) {
  return (
    <div style={{ height }} aria-label="Study time by subject">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="minutes"
            nameKey="name"
            innerRadius="58%"
            outerRadius="85%"
            paddingAngle={2}
            strokeWidth={0}
          >
            {data.map((d, i) => (
              <Cell key={i} fill={d.color} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip unit="m" />} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function HeatmapGrid({ data, className }: { data: DailyCell[]; className?: string }) {
  // 12 weeks × 7 days
  const weeks: DailyCell[][] = [];
  for (let w = 0; w < 12; w++) {
    weeks.push(data.slice(w * 7, w * 7 + 7));
  }
  const max = Math.max(1, ...data.map((d) => d.minutes));
  const level = (minutes: number) => {
    if (minutes <= 0) return "bg-muted/60";
    const r = minutes / max;
    if (r < 0.25) return "bg-primary/25";
    if (r < 0.5) return "bg-primary/45";
    if (r < 0.75) return "bg-primary/70";
    return "bg-primary";
  };
  return (
    <div className={cn("overflow-x-auto", className)}>
      <div className="grid grid-flow-col gap-1" style={{ gridTemplateRows: "repeat(7, 12px)" }}>
        {weeks.map((week, wi) => (
          <div key={wi} className="grid gap-1" style={{ gridTemplateRows: "repeat(7, 12px)" }}>
            {week.map((d) => (
              <div
                key={d.date}
                title={`${d.date}: ${Math.round(d.minutes)}m`}
                className={cn("h-3 w-3 rounded-[4px]", level(d.minutes))}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
        Less
        {[0, 0.25, 0.5, 0.75, 1].map((l) => (
          <span
            key={l}
            className={cn(
              "h-2.5 w-2.5 rounded-[3px]",
              l === 0 ? "bg-muted/60" : l === 0.25 ? "bg-primary/25" : l === 0.5 ? "bg-primary/45" : l === 0.75 ? "bg-primary/70" : "bg-primary",
            )}
          />
        ))}
        More
      </div>
    </div>
  );
}

export { ChartTooltip };