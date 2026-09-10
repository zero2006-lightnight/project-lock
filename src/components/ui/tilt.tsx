"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/* Pointer-driven 3D tilt: rotates the panel in a perspective scene and
   moves a glare highlight with the cursor. Disabled on touch devices and
   for prefers-reduced-motion. Zero dependencies, rAF-throttled. */
export function Tilt({
  children,
  className,
  max = 9,
  scale = 1.015,
}: {
  children: React.ReactNode;
  className?: string;
  max?: number;
  scale?: number;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const raf = React.useRef<number>(0);

  const setVars = (rx: number, ry: number, gx: number, gy: number, s: number) => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--rx", `${rx.toFixed(2)}deg`);
    el.style.setProperty("--ry", `${ry.toFixed(2)}deg`);
    el.style.setProperty("--gx", `${gx.toFixed(1)}%`);
    el.style.setProperty("--gy", `${gy.toFixed(1)}%`);
    el.style.setProperty("--ts", `${s}`);
  };

  const onMove = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const el = ref.current;
    if (!el) return;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      setVars((0.5 - py) * max * 2, (px - 0.5) * max * 2, px * 100, py * 100, scale);
    });
  };

  const onLeave = () => {
    cancelAnimationFrame(raf.current);
    setVars(0, 0, 50, 50, 1);
  };

  React.useEffect(() => () => cancelAnimationFrame(raf.current), []);

  return (
    <div className={cn("scene-3d", className)}>
      <div
        ref={ref}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        className="tilt-3d glare"
        style={{ transform: "rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg)) scale(var(--ts, 1))" }}
      >
        {children}
      </div>
    </div>
  );
}
