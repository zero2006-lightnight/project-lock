import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  ChainProvider,
  describeChain,
  getEmbeddingsConfig,
  getProviderChain,
} from "@/lib/ai/provider";
import type { AIProvider } from "@/lib/ai/types";

const savedEnv = { ...process.env };

beforeEach(() => {
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.GROK_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.AI_API_KEY;
  delete process.env.AI_PROVIDER;
  delete process.env.AI_PRIORITY;
  delete process.env.OPENROUTER_MODEL;
  delete process.env.GROK_MODEL;
  delete process.env.GEMINI_MODEL;
  delete process.env.OPENROUTER_EMBED_MODEL;
  delete process.env.AI_BASE_URL;
  delete process.env.AI_EMBED_MODEL;
});

afterEach(() => {
  process.env = { ...savedEnv };
});

function stub(id: string, behavior: { fail?: string; text?: string; streamText?: string }): AIProvider {
  return {
    id,
    available: () => true,
    complete: async () => {
      if (behavior.fail) throw new Error(behavior.fail);
      return behavior.text ?? `${id}-reply`;
    },
    ...(behavior.streamText !== undefined
      ? {
          stream: async (_s: string, _u: string, _o: unknown, onDelta?: (c: string) => void) => {
            onDelta?.(behavior.streamText!);
            return behavior.streamText!;
          },
        }
      : {}),
  };
}

describe("ChainProvider failover", () => {
  it("uses the first healthy member", async () => {
    const chain = new ChainProvider([stub("a", { text: "A" }), stub("b", { text: "B" })]);
    expect(chain.available()).toBe(true);
    expect(await chain.complete("s", "u")).toBe("A");
  });

  it("fails over to the next member when the first throws", async () => {
    const chain = new ChainProvider([stub("a", { fail: "boom" }), stub("b", { text: "B" })]);
    expect(await chain.complete("s", "u")).toBe("B");
  });

  it("throws a chain-exhausted error naming members when all fail", async () => {
    const chain = new ChainProvider([stub("a", { fail: "e1" }), stub("b", { fail: "e2" })]);
    await expect(chain.complete("s", "u")).rejects.toThrow(/chain exhausted \(a, b\): e2/);
  });

  it("empty chain is unavailable with an honest id", () => {
    const chain = new ChainProvider([]);
    expect(chain.available()).toBe(false);
    expect(chain.id).toBe("chain:empty");
  });

  it("streams via members with stream, else delivers complete() as one delta", async () => {
    const deltas: string[] = [];
    const chain = new ChainProvider([stub("a", { fail: "no-stream" }), stub("b", { text: "whole" })]);
    const full = await chain.stream("s", "u", {}, (c) => deltas.push(c));
    expect(full).toBe("whole");
    expect(deltas.join("")).toBe("whole");
  });

  it("visionCapable reflects members", () => {
    expect(new ChainProvider([]).visionCapable()).toBe(false);
    expect(new ChainProvider([stub("a", {})]).visionCapable()).toBe(false);
  });
});

describe("getProviderChain + describeChain", () => {
  it("empty env yields an empty chain", () => {
    expect(getProviderChain()).toEqual([]);
    expect(describeChain().filter((m) => m.keyed)).toEqual([]);
  });

  it("respects AI_PRIORITY order and skips unkeyed providers", () => {
    process.env.GEMINI_API_KEY = "g-test";
    process.env.OPENROUTER_API_KEY = "o-test";
    process.env.AI_PRIORITY = "gemini,openrouter,grok";
    expect(getProviderChain().map((m) => m.id)).toEqual(["gemini", "openrouter"]);
  });

  it("appends the legacy AI_* provider last when not already represented", () => {
    process.env.AI_API_KEY = "legacy";
    process.env.AI_PROVIDER = "openai";
    process.env.AI_PRIORITY = "gemini";
    expect(getProviderChain().map((m) => m.id)).toEqual(["openai"]);
  });

  it("describeChain never leaks secret values", () => {
    process.env.OPENROUTER_API_KEY = "super-secret-value";
    const json = JSON.stringify(describeChain());
    expect(json).not.toContain("super-secret-value");
    expect(describeChain().find((m) => m.id === "openrouter")?.keyed).toBe(true);
  });
});

describe("getEmbeddingsConfig", () => {
  it("returns null with no keys", () => {
    expect(getEmbeddingsConfig()).toBeNull();
  });

  it("prefers OpenRouter, falls back to legacy AI_*", () => {
    process.env.AI_API_KEY = "legacy";
    expect(getEmbeddingsConfig()).toMatchObject({ baseUrl: "https://api.openai.com/v1" });
    process.env.OPENROUTER_API_KEY = "o-test";
    expect(getEmbeddingsConfig()).toMatchObject({
      baseUrl: "https://openrouter.ai/api/v1",
      model: "openai/text-embedding-3-small",
    });
  });
});
