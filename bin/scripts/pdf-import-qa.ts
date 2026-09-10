/**
 * One-off E2E for PL-015: build a real PDF syllabus, extract its text with
 * the production extraction service, then parse it with the production
 * parser (AI path when a key is present, heuristic otherwise).
 * Run: npx tsx scripts/tmp-pdf-import.ts
 */

/* Minimal .env loader (Next normally does this) */
import { readFileSync } from "node:fs";
try {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {
  /* no .env — heuristic path will be exercised */
}

import { extractText } from "../src/lib/services/extract";
import { parseSyllabusText, heuristicParse } from "../src/lib/services/syllabus-parse";

/* ── Build a real (if minimal) PDF by hand: xref table, object streams ── */
function buildPdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  let content = "BT /F1 11 Tf 14 TL 50 760 Td\n";
  for (const l of lines) content += `(${esc(l)}) Tj T*\n`;
  content += "ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

const SYLLABUS_LINES = [
  "Course Outline: Database Management Systems (CS-204)",
  "Instructor: Dr. Rahman - office hours Tue 3-5pm",
  "Grading: 30% midterm, 40% final, 30% project",
  "",
  "Unit 1: Introduction to DBMS",
  "Purpose of database systems",
  "Data models and schemas",
  "Three-level architecture",
  "Unit 2: Relational Model",
  "Relational algebra",
  "Keys and integrity constraints",
  "SQL fundamentals",
  "Unit 3: Database Design",
  "Entity-relationship modeling",
  "Functional dependencies",
  "Normalization (1NF to BCNF)",
  "Unit 4: Transactions",
  "ACID properties",
  "Concurrency control",
  "Recovery techniques",
];

async function main() {
  console.log("provider configured:", Boolean(process.env.AI_API_KEY));

  // 1) PDF → text via the production extraction service
  const pdf = buildPdf(SYLLABUS_LINES);
  const text = await extractText("pdf", "dbms-syllabus.pdf", pdf);
  console.log("extracted chars:", text.length);
  if (text.length < 100) throw new Error("PDF extraction came back too short");
  if (!text.includes("Normalization")) throw new Error("PDF extraction lost topic text");

  // 2) heuristic parser directly (deterministic, no network)
  const heur = heuristicParse(text);
  console.log("heuristic units:", heur?.subjects[0].units.length, "topics:", heur?.subjects[0].units.reduce((a, u) => a + u.topics.length, 0));
  if (!heur || heur.subjects[0].units.length < 3) throw new Error("heuristic parse missed unit structure");
  const names = heur.subjects[0].units.map((u) => u.name.toLowerCase()).join("|");
  if (!names.includes("unit 3") || !names.includes("unit 4")) throw new Error("heuristic parse missed units 3/4");

  // 3) full production parse path (AI if key present, heuristic fallback)
  const result = await parseSyllabusText(text, { defaultSubjectName: "Database Management Systems" });
  console.log("parse source:", result.source, "| warning:", result.warning ?? "none");
  const s = result.syllabus.subjects[0];
  const topicTotal = s.units.reduce((a, u) => a + u.topics.length, 0);
  console.log(`subject: "${s.name}" | units: ${s.units.length} | topics: ${topicTotal}`);
  for (const u of s.units) console.log(`  - ${u.name}: ${u.topics.map((t) => t.name).join(", ")}`);

  if (!s.units.length || !topicTotal) throw new Error("parse produced no topics");
  if (result.source === "ai") {
    if (!s.units.some((u) => /transaction/i.test(u.name))) throw new Error("AI parse lost the transactions unit");
  }

  console.log("PDF IMPORT E2E: PASS");
}

main().catch((e) => {
  console.error("PDF IMPORT E2E: FAIL —", e instanceof Error ? e.message : e);
  process.exit(1);
});
