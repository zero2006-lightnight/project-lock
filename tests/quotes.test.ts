import { describe, it, expect } from "vitest";
import { QUOTES, pickQuote, RECENT_LIMIT } from "@/lib/quotes";

describe("quote pool", () => {
  it("has a varied, non-trivial collection", () => {
    expect(QUOTES.length).toBeGreaterThanOrEqual(20);
    const categories = new Set(QUOTES.map((q) => q.category));
    expect(categories.size).toBeGreaterThanOrEqual(6);
    for (const q of QUOTES) {
      expect(q.text.length).toBeGreaterThan(10);
      expect(q.text.length).toBeLessThanOrEqual(140);
    }
    expect(new Set(QUOTES.map((q) => q.id)).size).toBe(QUOTES.length);
  });
});

describe("pickQuote", () => {
  it("avoids recently shown quotes", () => {
    const history = QUOTES.slice(0, 5).map((q) => q.id);
    for (let i = 0; i < 20; i++) {
      expect(history).not.toContain(pickQuote(history).id);
    }
  });

  it("falls back to the full pool when everything is recent", () => {
    const all = QUOTES.map((q) => q.id);
    expect(QUOTES.map((q) => q.id)).toContain(pickQuote(all).id);
  });

  it("is deterministic with an injected random source", () => {
    const a = pickQuote([], () => 0);
    const b = pickQuote([], () => 0);
    expect(a.id).toBe(b.id);
    expect(a.id).toBe(QUOTES[0]!.id);
  });

  it("recent window matches RECENT_LIMIT", () => {
    expect(RECENT_LIMIT).toBe(8);
  });
});
