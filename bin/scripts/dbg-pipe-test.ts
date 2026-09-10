import { readFileSync } from "node:fs";
import { runSyllabusPipeline } from "@/lib/services/syllabus-pipeline";

const dir = "C:/Users/aKris/AppData/Local/Temp/opencode";
async function t(name: string, file: string, mime: string) {
  const buf = Buffer.from(readFileSync(`${dir}/${file}`));
  const r = await runSyllabusPipeline(buf, file, mime, { importId: `t-${Date.now()}-${name}` });
  if (!r.ok) {
    console.log(`${name}: FAIL stage=${(r as { stage: string }).stage} err=${(r as { error: string }).error}`);
    return;
  }
  console.log(`${name}: OK source=${r.source} units=${r.syllabus.subjects[0]?.units.length} engine=${r.timings.engine}`);
}
async function main() {
  await t("uni-pdf", "uni.pdf", "application/pdf");
  await t("locked-pdf", "locked.pdf", "application/pdf");
  await t("garbage-pdf", "garbage.pdf", "application/pdf");
}
void main();
