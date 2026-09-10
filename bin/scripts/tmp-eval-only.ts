/** Throwaway: single live summary evaluation. Run: npx tsx scripts/tmp-eval-only.ts */
import { readFileSync } from "node:fs";
try {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* no .env */ }
import { evaluateSummaryText } from "../src/lib/assess/summary";

const MATERIAL = "Photosynthesis converts light energy into chemical energy. It occurs in chloroplasts. Light-dependent reactions run across the thylakoid membranes: water is split, releasing oxygen, and ATP plus NADPH are produced. The Calvin cycle runs in the stroma: carbon dioxide is fixed into sugar using ATP and NADPH, catalyzed by RuBisCO. ".repeat(4);

async function main() {
  for (let i = 1; i <= 4; i++) {
    try {
      const e = await evaluateSummaryText(
        MATERIAL,
        "Explain how the light-dependent reactions and the Calvin cycle are connected.",
        "Photosynthesis happens in chloroplasts. Light reactions in the thylakoid membranes split water and make ATP and NADPH. Then the Calvin cycle in the stroma fixes carbon dioxide into sugar using RuBisCO.",
      );
      console.log("score:", e.score, "|", e.understanding, e.completeness, e.accuracy, e.clarity);
      console.log("overall:", e.overallAssessment.slice(0, 120));
      console.log("correct:", e.correctPoints.length, "| missing:", e.missingPoints.length, "| mistakes:", e.mistakes.length, "| improved len:", e.suggestedImprovedAnswer.length);
      console.log("EVAL PASS");
      return;
    } catch (err) {
      console.log(`attempt ${i}:`, err instanceof Error ? err.message.slice(0, 120) : err);
      await new Promise((r) => setTimeout(r, 90000));
    }
  }
  throw new Error("quota never cleared");
}
main().catch((e) => { console.error("EVAL FAILED:", e.message); process.exit(1); });
