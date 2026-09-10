/* ──────────────────────────────────────────────────────────────
   Tuning embeddings — provider-first, deterministic-local fallback.

   When an OpenAI-compatible embeddings endpoint is reachable we use
   real model embeddings; otherwise every KB still gets a working
   semantic index from hashed token vectors (same function embeds
   documents AND queries, so retrieval stays consistent). The source
   ("provider" | "local") is stored per knowledge base and shown in
   the UI — never silently mixed within one KB.
   ────────────────────────────────────────────────────────────── */
import { getEmbeddingsConfig } from "@/lib/ai/provider";

export const EMBED_DIM = 256;

/** FNV-1a 32-bit hash — deterministic across processes. */
export function hashToken(token: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+\-#/ ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && t.length <= 40);
}

/** Deterministic local embedding: hashed unigrams + bigrams, L2-normalized. */
export function localEmbed(text: string, dim = EMBED_DIM): number[] {
  const vec = new Array<number>(dim).fill(0);
  const tokens = tokenize(text);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    vec[hashToken(t) % dim]! += 1;
    vec[hashToken(`2:${t}`) % dim]! += 0.5;
    if (i > 0) vec[hashToken(`${tokens[i - 1]} ${t}`) % dim]! += 0.7;
  }
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => v / norm);
}

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function parseEmbedding(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v.filter((x) => typeof x === "number") as number[]) : [];
  } catch {
    return [];
  }
}

/** Try real provider embeddings; null on any failure (caller falls back). */
async function providerEmbed(texts: string[]): Promise<number[][] | null> {
  const cfg = getEmbeddingsConfig();
  if (!cfg) return null;
  try {
    const res = await fetch(`${cfg.baseUrl}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, input: texts }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: { embedding?: number[] }[] };
    if (!data.data?.length) return null;
    const vecs = data.data.map((d) => d.embedding ?? []);
    if (vecs.some((v) => !v.length)) return null;
    return vecs;
  } catch {
    return null;
  }
}

export type EmbedSource = "provider" | "local";

/** Embed many texts; returns vectors + which source produced them. */
export async function embedTexts(texts: string[]): Promise<{ vectors: number[][]; source: EmbedSource }> {
  if (!texts.length) return { vectors: [], source: "local" };
  const via = await providerEmbed(texts);
  if (via && via.length === texts.length) return { vectors: via, source: "provider" };
  return { vectors: texts.map((t) => localEmbed(t)), source: "local" };
}

/** Rank candidate indexes by cosine similarity to the query vector. */
export function rankBySimilarity(query: number[], candidates: number[][], topK: number): number[] {
  return candidates
    .map((c, i) => ({ i, s: cosine(query, c) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, Math.max(1, topK))
    .map((r) => r.i);
}
