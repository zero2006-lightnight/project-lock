"use client";

import { motion } from "motion/react";
import { pageEnter } from "./variants";

/* Route-level entrance: soft fade-up, once per navigation.
 * Used with key={pathname} so each route enters cleanly. */
export function PageEnter({ children }: { children: React.ReactNode }) {
  return (
    <motion.div variants={pageEnter} initial="hidden" animate="show">
      {children}
    </motion.div>
  );
}
