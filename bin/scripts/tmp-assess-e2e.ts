/** Throwaway live E2E for Exams assessment. Run: npx tsx scripts/tmp-assess-e2e.ts */
import { readFileSync } from "node:fs";
try {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* no .env */ }

import { generateQuizSet, gradeQuiz } from "../src/lib/assess/quiz";
import { generateSummaryPrompt, evaluateSummaryText } from "../src/lib/assess/summary";

const MATERIAL = [
  "Photosynthesis converts light energy into chemical energy in plants, algae and cyanobacteria.",
  "It occurs in chloroplasts. Chlorophyll pigments in the thylakoid membranes absorb red and blue light.",
  "Light-dependent reactions run across the thylakoid membranes: water is split (photolysis), releasing oxygen, and ATP plus NADPH are produced.",
  "The Calvin cycle runs in the stroma: carbon dioxide is fixed into sugar using the ATP and NADPH, catalyzed by the enzyme RuBisCO.",
  "Overall equation: 6CO2 + 6H2O + light energy -> C6H12O6 + 6O2.",
  "Factors affecting the rate include light intensity, carbon dioxide concentration, temperature, and water availability.",
].join(" ").repeat(3); // comfortably over the 300-char floor

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Free-tier quota is tiny — back off patiently on 429s. */
async function patient<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (/429|rate limit/i.test(msg) && attempt < 5) {
        console.log(`${label}: quota hit, waiting 60s (attempt ${attempt}/5)…`);
        await sleep(60000);
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}

async function main() {
  console.log("provider configured:", Boolean(process.env.AI_API_KEY), process.env.AI_MODEL);

  const set = await patient("quiz", () => generateQuizSet(MATERIAL, { count: 3, difficulty: "mixed" }));
  console.log("quiz questions:", set.questions.length);
  const first = set.questions[0]!;
  console.log("q1:", first.question.slice(0, 90));
  console.log("q1 options:", first.options.length, "| correct idx:", first.correctOptionIndex, "| topic:", first.topic);
  if (set.questions.length !== 3 || first.options.length !== 4) throw new Error("QUIZ SHAPE WRONG");

  const graded = gradeQuiz(set.questions, set.questions.map((x) => x.correctOptionIndex));
  if (graded.correctCount !== 3 || graded.scorePercent !== 100) throw new Error("GRADING WRONG");
  const gradedWrong = gradeQuiz(set.questions, set.questions.map(() => 0));
  console.log("all-correct score:", graded.scorePercent, "| all-first-option correct:", gradedWrong.correctCount);

  const prompt = await patient("prompt", () => generateSummaryPrompt(MATERIAL));
  console.log("summary prompt:", prompt.prompt.slice(0, 100));
  const evaluation = await patient("eval", () =>
    evaluateSummaryText(
      MATERIAL,
      prompt.prompt,
      "Photosynthesis happens in chloroplasts. Light reactions in the thylakoid membranes split water and make ATP and NADPH. Then the Calvin cycle in the stroma fixes carbon dioxide into sugar using RuBisCO.",
    ),
  );
  console.log("eval score:", evaluation.score, "| bands:", evaluation.understanding, evaluation.completeness, evaluation.accuracy, evaluation.clarity);
  console.log("correct:", evaluation.correctPoints.length, "| missing:", evaluation.missingPoints.length, "| mistakes:", evaluation.mistakes.length);
  if (!evaluation.suggestedImprovedAnswer) throw new Error("NO IMPROVED ANSWER");
  console.log("ASSESS E2E PASS");
}

main().catch((e) => { console.error("ASSESS E2E FAILED:", e.message); process.exit(1); });
