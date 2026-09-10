import { readFileSync } from "node:fs";
import { extractText } from "@/lib/services/extract";

async function main() {
  const dir = "C:/Users/aKris/AppData/Local/Temp/opencode";
  // Node fallback on valid PDF
  const uni = Buffer.from(readFileSync(`${dir}/uni.pdf`));
  const text = await extractText("pdf", "uni.pdf", uni);
  console.log("fallback uni chars:", text.length, "| head:", JSON.stringify(text.slice(0, 60)));
  // Node fallback on locked PDF — must surface password signal
  const locked = Buffer.from(readFileSync(`${dir}/locked.pdf`));
  try {
    const t2 = await extractText("pdf", "locked.pdf", locked);
    console.log("fallback locked chars:", t2.length);
  } catch (e) {
    console.log("fallback locked threw:", e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120));
  }
}
void main();
