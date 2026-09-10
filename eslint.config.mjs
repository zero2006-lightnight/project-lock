import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Non-app artifacts (PL-011): Python venv, QA browser profiles (contain
    // thousands of minified third-party extension files), runtime data.
    "venv/**",
    "data/**",
    "scripts/.chrome-*/**",
    "scripts/.shots/**",
  ]),
  // Neo-brutalism migration guard (Phase 0): soft depth must not sneak back
  // into app surfaces. Warn (not error) while pre-existing call sites in
  // Phase 2–4 files still migrate. Landing (src/app/page.tsx) is exempt
  // until Phase 4. `shadow-brutal-*` does NOT match (no sm/md/lg right
  // after `shadow-`).
  {
    files: [
      "src/app/app/**/*.{ts,tsx}",
      "src/components/ui/**/*.{ts,tsx}",
      "src/components/app/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          selector:
            "Literal[value=/shadow-(sm|md|lg|xl|2xl)|backdrop-blur|bg-gradient-/]",
          message:
            "Soft-UI depth is banned in app surfaces — use shadow-brutal-sm|brutal|brutal-md|brutal-lg, flat fills, no blur (neo-brutalism Phase 0+).",
        },
        {
          selector:
            "TemplateElement[value.raw=/shadow-(sm|md|lg|xl|2xl)|backdrop-blur|bg-gradient-/]",
          message:
            "Soft-UI depth is banned in app surfaces — use shadow-brutal-sm|brutal|brutal-md|brutal-lg, flat fills, no blur (neo-brutalism Phase 0+).",
        },
      ],
    },
  },
]);

export default eslintConfig;
