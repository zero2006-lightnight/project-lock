import { describe, it, expect } from "vitest";
import { heuristicParse, ParsedSyllabusSchema } from "@/lib/services/syllabus-parse";

describe("heuristicParse (deterministic syllabus parser)", () => {
  it("parses unit headings and topic lists, dropping noise lines", () => {
    const text = [
      "Course Outline — Database Management Systems",
      "Instructor: Dr. Someone (someone@university.edu)",
      "Grading: 30% midterm, 70% final",
      "",
      "Unit 1: Introduction",
      "Purpose of DBMS",
      "Data models overview",
      "Module 2 - Relational Model",
      "Keys and constraints",
      "1. Normalization",
      "Office hours: Tue 3-5pm",
    ].join("\n");

    const result = heuristicParse(text);
    expect(result).not.toBeNull();
    expect(result!.subjects).toHaveLength(1);
    const units = result!.subjects[0].units;
    expect(units).toHaveLength(2);
    expect(units[0].name.toLowerCase()).toContain("unit 1");
    expect(units[0].topics.map((t) => t.name)).toEqual(["Purpose of DBMS", "Data models overview"]);
    expect(units[1].name.toLowerCase()).toContain("module 2");
    // "1. Normalization" keeps numbering stripped; noise lines dropped
    expect(units[1].topics.map((t) => t.name)).toEqual(["Keys and constraints", "Normalization"]);
  });

  it("returns null when there is not enough syllabus signal", () => {
    expect(heuristicParse("Hello world\nThis is not a syllabus\nJust three lines of prose")).toBeNull();
  });

  it("caps units and topics at schema limits", () => {
    const lines: string[] = [];
    for (let u = 1; u <= 15; u++) {
      lines.push(`Unit ${u}: Chapter ${u}`);
      for (let t = 1; t <= 45; t++) lines.push(`Topic number ${t} of unit ${u}`);
    }
    const result = heuristicParse(lines.join("\n"));
    expect(result).not.toBeNull();
    const units = result!.subjects[0].units;
    expect(units.length).toBeLessThanOrEqual(10);
    for (const u of units) expect(u.topics.length).toBeLessThanOrEqual(40);
  });
});

describe("ParsedSyllabusSchema (AI output validation)", () => {
  it("accepts a well-formed structure and coerces bad difficulty", () => {
    const parsed = ParsedSyllabusSchema.parse({
      subjects: [
        {
          name: "DBMS",
          units: [{ name: "Unit 1", topics: [{ name: "Normalization", difficulty: 99 }, { name: "Transactions" }] }],
        },
      ],
    });
    expect(parsed.subjects[0].units[0].topics[0].difficulty).toBe(5); // clamped
    expect(parsed.subjects[0].units[0].topics[1].difficulty).toBe(3); // default
  });

  it("rejects structures without any subject", () => {
    expect(() => ParsedSyllabusSchema.parse({ subjects: [] })).toThrow();
  });

  it("caps runaway model output", () => {
    const huge = {
      subjects: Array.from({ length: 20 }, (_, i) => ({
        name: `S${i}`,
        units: Array.from({ length: 30 }, (_, j) => ({
          name: `U${j}`,
          topics: Array.from({ length: 50 }, (_, k) => ({ name: `T${k}`, difficulty: 3 })),
        })),
      })),
    };
    const result = ParsedSyllabusSchema.safeParse(huge);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.subjects.length).toBeLessThanOrEqual(8);
      for (const s of result.data.subjects) {
        expect(s.units.length).toBeLessThanOrEqual(10);
        for (const u of s.units) expect(u.topics.length).toBeLessThanOrEqual(40);
      }
    }
  });
});
