"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export function Progress({
  value,
  tone = "primary",
  className,
  trackClassName,
}: {
  value: number; // 0..100
  tone?: "primary" | "success" | "warning" | "danger" | "accent";
  className?: string;
  trackClassName?: string;
}) {
  const v = Math.max(0, Math.min(100, value));
  const color = {
    primary: "bg-lime",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
    accent: "bg-accent",
  }[tone];
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(v)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("h-4 w-full overflow-hidden rounded-[4px] border-2 border-ink bg-card", trackClassName)}
    >        <div
          className={cn("bar-grow h-full border-r-2 border-ink transition-[width] duration-700 ease-out", color, className)}
          style={{ width: `${v}%` }}
        />
    </div>
  );
}

export function Ring({
  value,
  size = 120,
  stroke = 10,
  tone = "primary",
  label,
  sublabel,
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  tone?: "primary" | "success" | "warning" | "danger" | "accent";
  label?: string;
  sublabel?: string;
  children?: React.ReactNode;
}) {
  const v = Math.max(0, Math.min(100, value));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const colors = {
    primary: "var(--color-primary)",
    success: "var(--color-success)",
    warning: "var(--color-warning)",
    danger: "var(--color-danger)",
    accent: "var(--color-accent)",
  };
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-muted)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={colors[tone]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (c * v) / 100}
          style={{ transition: "stroke-dashoffset 0.9s cubic-bezier(0.22,1,0.36,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {children ?? (
          <>
            {label && <span className="text-2xl font-bold tracking-tight">{label}</span>}
            {sublabel && <span className="text-xs text-muted-foreground">{sublabel}</span>}
          </>
        )}
      </div>
    </div>
  );
}
