"use client";

import * as React from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

const options = [
  { key: "light", label: "Light", icon: Sun },
  { key: "dark", label: "Dark", icon: Moon },
  { key: "system", label: "System", icon: Monitor },
] as const;

type GlobalTheme = {
  __spTheme?: string;
  __spSetTheme?: (t: string) => void;
  addEventListener?: (type: string, cb: () => void) => void;
  removeEventListener?: (type: string, cb: () => void) => void;
  dispatchEvent?: (event: Event) => boolean;
};

function subscribeTheme(onChange: () => void) {
  const w = window as unknown as GlobalTheme;
  w.addEventListener?.("sp-theme-change", onChange);
  return () => w.removeEventListener?.("sp-theme-change", onChange);
}

function readTheme() {
  return (window as unknown as GlobalTheme).__spTheme ?? "system";
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  // SSR renders "system"; the store subscription syncs the real value
  // after hydration without a setState-in-effect.
  const theme = React.useSyncExternalStore(
    subscribeTheme,
    readTheme,
    () => "system",
  );

  const apply = (t: string) => {
    const w = window as unknown as GlobalTheme;
    w.__spSetTheme?.(t);
    w.dispatchEvent?.(new Event("sp-theme-change"));
  };

  if (compact) {
    const current = options.find((o) => o.key === theme) ?? options[2];
    const Icon = current.icon;
    return (
      <button
        onClick={() => {
          const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
          apply(next);
        }}
        aria-label={`Theme: ${current.label}. Click to change.`}
        className="flex h-9 items-center gap-2 rounded-xl bg-card px-3 text-sm font-medium shadow-raise-sm tactile cursor-pointer"
      >
        <Icon className="h-4 w-4" />
        <span className="hidden sm:inline">{current.label}</span>
      </button>
    );
  }

  return (
    <div
      className="inline-flex items-center rounded-xl bg-muted p-1 shadow-inset-sm"
      role="radiogroup"
      aria-label="Color theme"
    >
      {options.map((o) => {
        const Icon = o.icon;
        const active = theme === o.key;
        return (
          <button
            key={o.key}
            role="radio"
            aria-checked={active}
            onClick={() => apply(o.key)}
            className={cn(
              "relative inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-all duration-150",
              active ? "bg-card text-foreground shadow-raise-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {o.label}
            {active && <Check className="h-3 w-3 text-primary" />}
          </button>
        );
      })}
    </div>
  );
}
