"use client";

import { MotionConfig } from "motion/react";

/* Global motion policy: the OS reduced-motion setting disables all
   transform/layout animations from the motion system automatically.
   (CSS keyframe animations are covered by the existing
   prefers-reduced-motion kill block in globals.css.) */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
