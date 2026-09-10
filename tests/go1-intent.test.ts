import { describe, it, expect } from "vitest";
import { newRequestId, parseVoiceIntent } from "@/lib/voice/intent";
import { summarizeForSpeech } from "@/lib/voice/speech";

const CTX = { pathname: "/app", subjectNames: ["DBMS", "DSA"] };

describe("parseVoiceIntent — navigation", () => {
  it("routes open/show/go-to requests to existing routes", () => {
    expect(parseVoiceIntent("Open the exams section", CTX)).toEqual({ kind: "navigation", route: "/app/exams", label: "Exams" });
    expect(parseVoiceIntent("Go to my progress", CTX)).toEqual({ kind: "navigation", route: "/app/progress", label: "Progress" });
    expect(parseVoiceIntent("Show me my syllabus", CTX)).toEqual({ kind: "navigation", route: "/app/syllabus", label: "Syllabus" });
  });
});

describe("parseVoiceIntent — generation with parameters", () => {
  it("extracts difficulty and unit for quiz requests", () => {
    const r = parseVoiceIntent("Create a difficult quiz from unit 3", CTX);
    expect(r).toMatchObject({ kind: "generation", target: "quiz", difficulty: "hard", unit: 3, route: "/app/exams" });
  });

  it("detects flashcard and mind map targets", () => {
    expect(parseVoiceIntent("Generate flashcards from unit 2", CTX)).toMatchObject({ kind: "generation", target: "flashcards", unit: 2 });
    expect(parseVoiceIntent("Make a mind map from unit 1", CTX)).toMatchObject({ kind: "generation", target: "mindmap", unit: 1 });
  });

  it("asks which subject for unscoped generation with several subjects", () => {
    expect(parseVoiceIntent("Generate flashcards for this topic", CTX).kind).toBe("ambiguous");
    expect(parseVoiceIntent("Generate flashcards", { pathname: "/app", subjectNames: ["DBMS"] }).kind).toBe("generation");
  });

  it("asks for clarification on bare quiz with several subjects", () => {
    const r = parseVoiceIntent("Create a quiz", CTX);
    expect(r.kind).toBe("ambiguous");
  });
});

describe("parseVoiceIntent — safety", () => {
  it("never executes destructive actions directly", () => {
    expect(parseVoiceIntent("Delete unit 3", CTX)).toMatchObject({ kind: "destructive", needsConfirm: true });
    expect(parseVoiceIntent("Generate a quiz from unit 3", CTX).kind).toBe("generation");
  });

  it("recognizes confirmation answers", () => {
    expect(parseVoiceIntent("yes, do it", CTX)).toEqual({ kind: "confirm", value: true });
    expect(parseVoiceIntent("no, cancel", CTX)).toEqual({ kind: "confirm", value: false });
  });

  it("handles interruption controls", () => {
    expect(parseVoiceIntent("Stop", CTX)).toEqual({ kind: "control", action: "stop" });
    expect(parseVoiceIntent("Repeat that", CTX)).toEqual({ kind: "control", action: "repeat" });
  });
});

describe("parseVoiceIntent — info fallback", () => {
  it("treats explanations as Pilot questions", () => {
    expect(parseVoiceIntent("Explain linked lists", CTX)).toEqual({ kind: "info", question: "Explain linked lists" });
  });

  it("returns unknown for empty input", () => {
    expect(parseVoiceIntent("   ", CTX)).toEqual({ kind: "unknown" });
  });
});

describe("parseVoiceIntent — autonomous actions", () => {
  it("extracts task creation entities", () => {
    expect(parseVoiceIntent("Create a DBMS assignment tomorrow at 5 PM high priority", CTX)).toMatchObject({
      kind: "task",
      action: "create",
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      priority: 3,
    });
  });

  it("routes planning and notification commands", () => {
    expect(parseVoiceIntent("Regenerate today's plan", CTX)).toEqual({ kind: "planning", action: "regenerate" });
    expect(parseVoiceIntent("Reschedule missed sessions", CTX)).toEqual({ kind: "planning", action: "reschedule" });
    expect(parseVoiceIntent("Mark my notifications read", CTX)).toEqual({ kind: "notification", message: "read" });
  });
});

describe("summarizeForSpeech", () => {
  it("keeps short replies whole", () => {
    expect(summarizeForSpeech("Arrays are contiguous.")).toBe("Arrays are contiguous.");
  });

  it("condenses long replies to a speakable summary", () => {
    const long =
      "Arrays store elements contiguously in memory, giving fast indexed access. " +
      "In Python, the list type is the dynamic array you use daily. " +
      "Appending is amortized constant time, while inserting at the front is linear. " +
      "For numeric work, the array module and NumPy offer fixed-type storage. ".repeat(6);
    const s = summarizeForSpeech(long);
    expect(s.length).toBeLessThanOrEqual(420);
    expect(s).toMatch(/Arrays store elements/);
  });
});

describe("newRequestId", () => {
  it("produces unique ids for idempotent execution", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newRequestId()));
    expect(ids.size).toBe(50);
    expect(newRequestId()).toMatch(/^[0-9a-f]{32}$/);
  });
});
