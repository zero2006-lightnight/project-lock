import { describe, it, expect } from "vitest";
import { verifyUpload } from "@/lib/security/uploads";
import { classifyPdfError, detectKind } from "@/lib/services/extract";

/* ──────────────────────────────────────────────────────────────
   Bug-fix verification: syllabus import accepts the promised
   formats (TXT/MD/JSON/CSV) and never misclassifies ordinary
   parse failures as password errors.
   ────────────────────────────────────────────────────────────── */

describe("detectKind — syllabus formats", () => {
  it("accepts pdf, docx, txt, md, csv, json and images", () => {
    expect(detectKind("syllabus.pdf", "application/pdf")).toBe("pdf");
    expect(detectKind("notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("word");
    expect(detectKind("outline.txt", "text/plain")).toBe("text");
    expect(detectKind("outline.md", "text/markdown")).toBe("text");
    expect(detectKind("units.csv", "text/csv")).toBe("excel");
    expect(detectKind("units.json", "application/json")).toBe("text");
    expect(detectKind("units.json", "")).toBe("text"); // extension alone
    expect(detectKind("diagram.png", "image/png")).toBe("image");
  });

  it("rejects unknown formats", () => {
    expect(detectKind("payload.exe", "application/octet-stream")).toBeNull();
  });
});

describe("verifyUpload — JSON magic check", () => {
  it("accepts a JSON object upload", () => {
    const buf = Buffer.from('{"subjects": []}');
    expect(verifyUpload("units.json", "application/json", buf)).toEqual({ ok: true, kind: "text" });
  });

  it("accepts a JSON array upload", () => {
    const buf = Buffer.from('[{"name":"Unit 1"}]');
    expect(verifyUpload("units.json", "", buf)).toEqual({ ok: true, kind: "text" });
  });

  it("rejects binary renamed to .json", () => {
    const buf = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff]);
    expect(verifyUpload("evil.json", "application/json", buf).ok).toBe(false);
  });
});

describe("classifyPdfError — password vs unreadable", () => {
  it("classifies PasswordException by name", () => {
    const e = new Error("No password given");
    e.name = "PasswordException";
    expect(classifyPdfError(e)).toBe("password");
  });

  it("classifies PASSWORD_REQUIRED sentinel messages", () => {
    expect(classifyPdfError(new Error("PASSWORD_REQUIRED"))).toBe("password");
  });

  it("never treats InvalidPDFException as a password error", () => {
    const e = new Error("Invalid PDF structure.");
    e.name = "InvalidPDFException";
    expect(classifyPdfError(e)).toBe("unreadable");
  });

  it("treats generic failures as unreadable", () => {
    expect(classifyPdfError(new Error("something broke"))).toBe("unreadable");
    expect(classifyPdfError(null)).toBe("unreadable");
  });
});
