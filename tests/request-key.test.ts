import { describe, it, expect } from "vitest";
import { clientIpFromHeaders, retryMinutes } from "@/lib/security/request-key";

function headersWith(entries: Record<string, string>): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(entries)) h.set(k, v);
  return h;
}

describe("clientIpFromHeaders", () => {
  it("uses the first x-forwarded-for hop (original client)", () => {
    const h = headersWith({ "x-forwarded-for": "203.0.113.7, 10.0.0.1, 10.0.0.2" });
    expect(clientIpFromHeaders(h)).toBe("203.0.113.7");
  });

  it("trims whitespace around the first hop", () => {
    const h = headersWith({ "x-forwarded-for": " 203.0.113.9 , 10.0.0.1" });
    expect(clientIpFromHeaders(h)).toBe("203.0.113.9");
  });

  it("falls back to x-real-ip", () => {
    const h = headersWith({ "x-real-ip": "198.51.100.4" });
    expect(clientIpFromHeaders(h)).toBe("198.51.100.4");
  });

  it("returns 'local' when no proxy headers exist (direct dev/LAN access)", () => {
    expect(clientIpFromHeaders(headersWith({}))).toBe("local");
  });

  it("ignores an empty x-forwarded-for and still falls back", () => {
    const h = headersWith({ "x-forwarded-for": "", "x-real-ip": "198.51.100.5" });
    expect(clientIpFromHeaders(h)).toBe("198.51.100.5");
  });
});

describe("retryMinutes", () => {
  it("rounds up so users never see '0 minutes'", () => {
    expect(retryMinutes(1)).toBe(1);
    expect(retryMinutes(59_000)).toBe(1);
    expect(retryMinutes(61_000)).toBe(2);
    expect(retryMinutes(0)).toBe(1);
  });
});
