import { z } from "zod";
import { AiSchemaError, type AIProvider } from "./types";

/* ──────────────────────────────────────────────────────────────
   No provider call may hang forever: every fetch carries an abort
   signal so a stalled AI endpoint fails fast instead of freezing
   the UI (infinite spinners). Timeouts surface as normal errors
   through the existing friendly-error paths.
   ────────────────────────────────────────────────────────────── */
const CHAT_TIMEOUT_MS = 90_000;
const VISION_TIMEOUT_MS = 45_000;
const IMAGE_GEN_TIMEOUT_MS = 120_000;

/* ──────────────────────────────────────────────────────────────
   OpenAI-compatible adapter — also works against any endpoint
   speaking the /v1/chat/completions dialect (OpenRouter, Groq,
   xAI Grok, Together, Ollama, LM Studio, ...) via baseUrl.
   Instances are configured explicitly (per-provider keys); the
   no-arg construction preserves the legacy AI_* env behavior.
   ────────────────────────────────────────────────────────────── */
export type OpenAICompatibleConfig = {
  id?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  extraHeaders?: Record<string, string>;
};

export class OpenAICompatibleProvider implements AIProvider {
  readonly id: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly extraHeaders: Record<string, string>;

  constructor(cfg: OpenAICompatibleConfig = {}) {
    this.id = cfg.id ?? "openai";
    this.apiKey = cfg.apiKey ?? process.env.AI_API_KEY ?? "";
    this.baseUrl = (cfg.baseUrl ?? process.env.AI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.model = cfg.model ?? process.env.AI_MODEL ?? "gpt-4o-mini";
    this.extraHeaders = cfg.extraHeaders ?? {};
  }

  available() {
    return Boolean(this.apiKey);
  }

  /** Parse an OpenAI-style SSE line into its data payload (null if none). */
  private sseData(line: string): string | null {
    if (!line.startsWith("data:")) return null;
    const payload = line.slice(5).trim();
    return payload && payload !== "[DONE]" ? payload : null;
  }

  /** True token streaming for OpenAI-dialect providers (Groq included).
   *  Each parsed delta is handed to onDelta (if given) and accumulated. */
  async stream(system: string, user: string, opts?: { temperature?: number; maxTokens?: number }, onDelta?: (chunk: string) => void): Promise<string> {
    const { apiKey, baseUrl, model } = this;
    if (!apiKey) throw new Error("AI_API_KEY is not configured");

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...this.extraHeaders,
      },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: opts?.temperature ?? 0.5,
        max_tokens: opts?.maxTokens ?? 900,
      }),
    });
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      throw new Error(`AI provider error ${res.status}: ${body.slice(0, 300)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // keep the partial trailing line
      for (const line of lines) {
        const payload = this.sseData(line);
        if (payload == null) continue;
        try {
          const json = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            full += delta;
            onDelta?.(delta);
          }
        } catch {
          // A malformed keepalive/frame is skipped, not fatal.
        }
      }
    }
    return full;
  }

  /** Best-effort image generation via the OpenAI images dialect. */
  async generateImage(prompt: string): Promise<string> {
    const { apiKey, baseUrl } = this;
    const model = process.env.AI_IMAGE_MODEL || "gpt-image-1";
    if (!apiKey) throw new Error("AI_API_KEY is not configured");
    const res = await fetch(`${baseUrl}/images/generations`, {
      method: "POST",
      signal: AbortSignal.timeout(IMAGE_GEN_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...this.extraHeaders,
      },
      body: JSON.stringify({ model, prompt, size: "1024x1024", n: 1 }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Image provider error ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as { data?: ({ url?: string; b64_json?: string } | undefined)[] };
    const first = data.data?.[0];
    if (first?.url) return first.url;
    if (first?.b64_json) return `data:image/png;base64,${first.b64_json}`;
    throw new Error("Image provider returned no image");
  }

  visionCapable() {
    return Boolean(this.apiKey);
  }

  /** Vision via the OpenAI chat-completions image_url dialect. */
  async describeImage(imageBase64: string, mimeType: string, system: string, user: string, opts?: { maxTokens?: number }): Promise<string> {
    const { apiKey, baseUrl } = this;
    const model = process.env.AI_VISION_MODEL || this.model;
    if (!apiKey) throw new Error("AI_API_KEY is not configured");
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(VISION_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...this.extraHeaders,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: [
              { type: "text", text: user },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
            ],
          },
        ],
        temperature: 0.3,
        max_tokens: opts?.maxTokens ?? 1200,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Vision provider error ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Vision provider returned an empty response");
    return content;
  }

  async complete(system: string, user: string, opts?: { temperature?: number; maxTokens?: number }): Promise<string> {
    const { apiKey, baseUrl, model } = this;
    if (!apiKey) throw new Error("AI_API_KEY is not configured");

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...this.extraHeaders,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: opts?.temperature ?? 0.5,
        max_tokens: opts?.maxTokens ?? 900,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`AI provider error ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("AI provider returned an empty response");
    return content;
  }
}

/* ──────────────────────────────────────────────────────────────
   Anthropic adapter
   ────────────────────────────────────────────────────────────── */
export class AnthropicProvider implements AIProvider {
  readonly id = "anthropic";

  available() {
    return Boolean(process.env.AI_API_KEY);
  }

  async complete(system: string, user: string, opts?: { temperature?: number; maxTokens?: number }): Promise<string> {
    const apiKey = process.env.AI_API_KEY;
    const model = process.env.AI_MODEL || "claude-3-5-haiku-latest";
    if (!apiKey) throw new Error("AI_API_KEY is not configured");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: opts?.maxTokens ?? 900,
        temperature: opts?.temperature ?? 0.5,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Anthropic error ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as { content?: { text?: string }[] };
    const text = data.content?.map((c) => c.text ?? "").join("");
    if (!text) throw new Error("Anthropic returned an empty response");
    return text;
  }
}

/* ──────────────────────────────────────────────────────────────
   Google Gemini adapter (v1beta generateContent dialect).
   ────────────────────────────────────────────────────────────── */
export class GeminiProvider implements AIProvider {
  readonly id: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(cfg: { id?: string; apiKey?: string; model?: string } = {}) {
    this.id = cfg.id ?? "gemini";
    this.apiKey =
      cfg.apiKey ?? process.env.GEMINI_API_KEY ?? (isLegacyProvider("gemini") ? process.env.AI_API_KEY ?? "" : "");
    this.model = cfg.model ?? process.env.GEMINI_MODEL ?? process.env.AI_MODEL ?? "gemini-2.5-flash";
  }

  available() {
    return Boolean(this.apiKey);
  }

  private body(system: string, user: string, opts?: { temperature?: number; maxTokens?: number }) {
    return JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature: opts?.temperature ?? 0.5, maxOutputTokens: opts?.maxTokens ?? 900 },
    });
  }

  private static textFromJson(json: unknown): string {
    const data = json as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  }

  async complete(system: string, user: string, opts?: { temperature?: number; maxTokens?: number }): Promise<string> {
    const { apiKey, model } = this;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      { method: "POST", signal: AbortSignal.timeout(CHAT_TIMEOUT_MS), headers: { "Content-Type": "application/json" }, body: this.body(system, user, opts) },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Gemini error ${res.status}: ${body.slice(0, 300)}`);
    }
    const text = GeminiProvider.textFromJson(await res.json());
    if (!text) throw new Error("Gemini returned an empty response");
    return text;
  }

  async stream(system: string, user: string, opts?: { temperature?: number; maxTokens?: number }, onDelta?: (chunk: string) => void): Promise<string> {
    const { apiKey, model } = this;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`,
      { method: "POST", signal: AbortSignal.timeout(CHAT_TIMEOUT_MS), headers: { "Content-Type": "application/json" }, body: this.body(system, user, opts) },
    );
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      throw new Error(`Gemini error ${res.status}: ${body.slice(0, 300)}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        try {
          const delta = GeminiProvider.textFromJson(JSON.parse(payload));
          if (delta) {
            full += delta;
            onDelta?.(delta);
          }
        } catch {
          // Malformed keepalive frame — skipped, not fatal.
        }
      }
    }
    return full;
  }
}

/* ──────────────────────────────────────────────────────────────
   Reply helper: ask an LLM for a JSON object, then validate it.
   Never trusts the model — anything malformed is surfaced, not
   silently applied.
   ────────────────────────────────────────────────────────────── */
/* ──────────────────────────────────────────────────────────────
   Multi-provider chain with automatic failover.
   ──────────────────────────────────────────────────────────────
   Env contract (all optional; .env is gitignored):
     AI_PRIORITY="openrouter,grok,gemini"  # failover order
     OPENROUTER_API_KEY / OPENROUTER_MODEL (default openai/gpt-4o-mini)
     OPENROUTER_EMBED_MODEL (default openai/text-embedding-3-small)
     OPENROUTER_SITE_URL / OPENROUTER_APP_NAME (optional headers)
     GROK_API_KEY / GROK_MODEL (default grok-3-mini, via api.x.ai/v1)
     GEMINI_API_KEY / GEMINI_MODEL (default gemini-2.0-flash)
     AI_PROVIDER / AI_API_KEY / AI_BASE_URL / AI_MODEL (legacy single
       provider — kept as the last-resort member and rollback target)
   getAiProvider() returns a ChainProvider, so every existing call
   site (chat, quiz, flashcards, tuning, syllabus-parse, assess)
   fails over automatically with zero edits. When every member is
   down the chain throws and callers degrade to the deterministic
   local engine — that is the per-request rollback.
   ────────────────────────────────────────────────────────────── */

/** True when the legacy AI_* vars explicitly select the named provider. */
function isLegacyProvider(name: string): boolean {
  return (process.env.AI_PROVIDER || "").toLowerCase() === name && Boolean(process.env.AI_API_KEY);
}

function openRouterHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  if (process.env.OPENROUTER_SITE_URL) h["HTTP-Referer"] = process.env.OPENROUTER_SITE_URL;
  if (process.env.OPENROUTER_APP_NAME) h["X-Title"] = process.env.OPENROUTER_APP_NAME;
  return h;
}

/** Build one chain member, or null when it has no key. */
function chainMember(id: string): AIProvider | null {
  switch (id) {
    case "openrouter": {
      const p = new OpenAICompatibleProvider({
        id: "openrouter",
        apiKey: process.env.OPENROUTER_API_KEY,
        baseUrl: "https://openrouter.ai/api/v1",
        model: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
        extraHeaders: openRouterHeaders(),
      });
      return p.available() ? p : null;
    }
    case "grok": {
      const p = new OpenAICompatibleProvider({
        id: "grok",
        apiKey: process.env.GROK_API_KEY,
        baseUrl: "https://api.x.ai/v1",
        model: process.env.GROK_MODEL || "grok-3-mini",
      });
      return p.available() ? p : null;
    }
    case "gemini": {
      const p = new GeminiProvider();
      return p.available() ? p : null;
    }
    case "anthropic": {
      const p = new AnthropicProvider();
      return p.available() ? p : null;
    }
    default:
      return null;
  }
}

/** Ordered, deduplicated list of keyed providers (primary first). */
export function getProviderChain(): AIProvider[] {
  const order = (process.env.AI_PRIORITY || "openrouter,grok,gemini")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const chain: AIProvider[] = [];
  const seen = new Set<string>();
  for (const id of order) {
    if (seen.has(id)) continue;
    seen.add(id);
    const member = chainMember(id);
    if (member) chain.push(member);
  }
  // Legacy single-provider config stays a valid last resort (and is the
  // rollback target): it is only appended when not already represented.
  if (process.env.AI_API_KEY && !seen.has((process.env.AI_PROVIDER || "openai").toLowerCase())) {
    chain.push(new OpenAICompatibleProvider());
  }
  return chain;
}

export class ChainProvider implements AIProvider {
  readonly members: AIProvider[];

  constructor(members?: AIProvider[]) {
    this.members = members ?? getProviderChain();
  }

  get id(): string {
    return this.members.length ? `chain:${this.members.map((m) => m.id).join(">")}` : "chain:empty";
  }

  available(): boolean {
    return this.members.some((m) => m.available());
  }

  private failure(suffix: string): Error {
    const ids = this.members.map((m) => m.id).join(", ") || "none configured";
    return new Error(`AI chain exhausted (${ids}): ${suffix}`);
  }

  async complete(system: string, user: string, opts?: { temperature?: number; maxTokens?: number }): Promise<string> {
    let lastErr = "no providers configured";
    for (const m of this.members) {
      try {
        return await m.complete(system, user, opts);
      } catch (err) {
        lastErr = err instanceof Error ? err.message : "unknown error";
      }
    }
    throw this.failure(lastErr);
  }

  async stream(system: string, user: string, opts?: { temperature?: number; maxTokens?: number }, onDelta?: (chunk: string) => void): Promise<string> {
    let lastErr = "no providers configured";
    for (const m of this.members) {
      try {
        if (m.stream) return await m.stream(system, user, opts, onDelta);
        // Member has no streaming transport: complete, then deliver the
        // whole reply as a single honest delta.
        const full = await m.complete(system, user, opts);
        if (full) onDelta?.(full);
        return full;
      } catch (err) {
        lastErr = err instanceof Error ? err.message : "unknown error";
      }
    }
    throw this.failure(lastErr);
  }

  async generateImage(prompt: string): Promise<string> {
    let lastErr = "no image-capable provider configured";
    for (const m of this.members) {
      if (!m.generateImage) continue;
      try {
        return await m.generateImage(prompt);
      } catch (err) {
        lastErr = err instanceof Error ? err.message : "unknown error";
      }
    }
    throw this.failure(lastErr);
  }

  visionCapable(): boolean {
    return this.members.some((m) => (m.visionCapable ? m.visionCapable() : Boolean(m.describeImage)));
  }

  async describeImage(imageBase64: string, mimeType: string, system: string, user: string, opts?: { maxTokens?: number }): Promise<string> {
    let lastErr = "no vision-capable provider configured";
    for (const m of this.members) {
      if (!m.describeImage) continue;
      try {
        return await m.describeImage(imageBase64, mimeType, system, user, opts);
      } catch (err) {
        lastErr = err instanceof Error ? err.message : "unknown error";
      }
    }
    throw this.failure(lastErr);
  }
}

export function getAiProvider(): AIProvider {
  return new ChainProvider();
}

/** Key presence + models for status surfaces. Never includes secrets. */
export function describeChain(): { id: string; model: string; keyed: boolean }[] {
  const models: Record<string, string> = {
    openrouter: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
    grok: process.env.GROK_MODEL || "grok-3-mini",
    gemini: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    anthropic: process.env.AI_MODEL || "claude-3-5-haiku-latest",
  };
  const order = (process.env.AI_PRIORITY || "openrouter,grok,gemini")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: { id: string; model: string; keyed: boolean }[] = [];
  for (const id of order) {
    if (seen.has(id) || !(id in models)) continue;
    seen.add(id);
    out.push({ id, model: models[id]!, keyed: getProviderChain().some((m) => m.id === id) });
  }
  if (process.env.AI_API_KEY) {
    out.push({ id: (process.env.AI_PROVIDER || "openai").toLowerCase(), model: process.env.AI_MODEL || "gpt-4o-mini", keyed: true });
  }
  return out;
}

/** Embeddings endpoint for Tuning chunk indexing. OpenRouter speaks the
 *  OpenAI /embeddings dialect; otherwise the legacy AI_* config; else
 *  null and Tuning falls back to its deterministic local index. */
export function getEmbeddingsConfig(): { apiKey: string; baseUrl: string; model: string } | null {
  if (process.env.OPENROUTER_API_KEY) {
    return {
      apiKey: process.env.OPENROUTER_API_KEY,
      baseUrl: "https://openrouter.ai/api/v1",
      model: process.env.OPENROUTER_EMBED_MODEL || "openai/text-embedding-3-small",
    };
  }
  if (process.env.AI_API_KEY) {
    return {
      apiKey: process.env.AI_API_KEY,
      baseUrl: (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
      model: process.env.AI_EMBED_MODEL || "text-embedding-3-small",
    };
  }
  return null;
}

export async function askForJson<T>(
  provider: AIProvider,
  system: string,
  user: string,
  schema: z.ZodTypeAny,
  retries = 1,
  opts?: { maxTokens?: number },
): Promise<T> {
  const maxTokens = opts?.maxTokens ?? 1200;
  const content = await provider.complete(
    `${system}\n\nRespond with ONLY a single valid JSON object. Do not wrap it in markdown fences or add commentary.`,
    user,
    { temperature: 0.2, maxTokens },
  );
  try {
    const json = extractJson(content);
    return schema.parse(json) as T;
  } catch (err) {
    if (retries > 0) {
      return askForJson(
        provider,
        system,
        `${user}\n\n(Your previous response failed validation. Return strictly valid JSON matching the schema.)`,
        schema,
        retries - 1,
        opts,
      );
    }
    if (err instanceof AiSchemaError) throw err;
    throw new AiSchemaError(`AI returned invalid data: ${err instanceof Error ? err.message : "unknown error"}`, content);
  }
}

function extractJson(content: string): unknown {
  const trimmed = content.trim();
  // strip markdown fences
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1]! : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    // some models return a leading line of prose; try to find the first { ... }
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new AiSchemaError("No JSON object found in model output", content);
  }
}
