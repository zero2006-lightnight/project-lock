import { describe, expect, it } from "vitest";
import { verifyUpload } from "@/lib/security/uploads";
import { isSameOriginRequest } from "@/lib/security/origin";

const pdf = (extra = "") => Buffer.from(`%PDF-1.4\n${extra}`);
const zip = () => Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);
const mz = () => Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
const elf = () => Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);

describe("verifyUpload (magic bytes beat extensions)", () => {
  it("accepts a genuine PDF", () => {
    expect(verifyUpload("syllabus.pdf", "application/pdf", pdf("unit 1"))).toEqual({ ok: true, kind: "pdf" });
  });

  it("accepts OOXML Office files", () => {
    expect(verifyUpload("notes.docx", "application/vnd.openxmlformats", zip()).ok).toBe(true);
    expect(verifyUpload("data.xlsx", "application/vnd.ms-excel", zip()).ok).toBe(true);
  });

  it("accepts plain-text CSVs without ZIP magic", () => {
    expect(verifyUpload("data.csv", "text/csv", Buffer.from("a,b\n1,2\n"))).toEqual({ ok: true, kind: "excel" });
  });

  it("rejects renamed executables regardless of extension", () => {
    expect(verifyUpload("syllabus.pdf", "application/pdf", mz()).ok).toBe(false);
    expect(verifyUpload("notes.docx", "application/vnd.openxmlformats", elf()).ok).toBe(false);
    expect(verifyUpload("data.xlsx", "application/vnd.ms-excel", mz()).ok).toBe(false);
  });

  it("rejects a text file masquerading as PDF", () => {
    expect(verifyUpload("syllabus.pdf", "application/pdf", Buffer.from("just some text, no pdf magic"))).toEqual({
      ok: false,
      error: "That file isn't a readable PDF.",
    });
  });

  it("rejects binary blobs claimed as text", () => {
    const bin = Buffer.concat([Buffer.from("hello"), Buffer.from([0x00, 0x01, 0x02])]);
    expect(verifyUpload("notes.txt", "text/plain", bin).ok).toBe(false);
  });

  it("rejects shell scripts posing as documents", () => {
    expect(verifyUpload("run.pdf", "application/pdf", Buffer.from("#!/bin/bash\nrm -rf /"))).toEqual({
      ok: false,
      error: "That file isn't an accepted document type.",
    });
  });

  it("accepts real images and rejects fake ones", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    expect(verifyUpload("pic.png", "image/png", png)).toEqual({ ok: true, kind: "image" });
    expect(verifyUpload("pic.png", "image/png", pdf()).ok).toBe(false);
  });
});

function req(host: string, origin?: string): Request {
  const headers: Record<string, string> = { host };
  if (origin) headers.origin = origin;
  return new Request("http://x/", { method: "POST", headers });
}

describe("isSameOriginRequest (CSRF guard)", () => {
  it("allows same-origin POSTs", () => {
    expect(isSameOriginRequest(req("localhost:3000", "http://localhost:3000"))).toBe(true);
  });

  it("blocks cross-origin POSTs", () => {
    expect(isSameOriginRequest(req("localhost:3000", "https://evil.example"))).toBe(false);
    expect(isSameOriginRequest(req("localhost:3000", "http://localhost:3000 attacker.com"))).toBe(false);
  });

  it("allows header-less non-browser clients (auth still enforced separately)", () => {
    expect(isSameOriginRequest(req("localhost:3000"))).toBe(true);
  });
});
