/* Pure speech helpers — no browser APIs, unit-tested. */

/** Condense a Pilot reply into a speakable summary (full text stays on screen). */
export function summarizeForSpeech(text: string, max = 420): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const sentences = clean.match(/[^.!?]+[.!?]+/g) ?? [clean];
  let out = "";
  for (const s of sentences) {
    if ((out + s).trim().length > max) break;
    out += s + " ";
    if (out.trim().length > 160 && sentences.indexOf(s) >= 1) break;
  }
  return (out.trim() || clean.slice(0, max)).trim();
}
