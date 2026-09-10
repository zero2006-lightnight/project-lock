import { describe, it, expect } from "vitest";
import {
  dedupeSyllabus,
  fingerprintBytes,
  heuristicConfident,
  normalizeTitle,
} from "@/lib/services/syllabus-pipeline";

describe("normalizeTitle (duplicate detection)", () => {
  it("treats case/punctuation variants as the same topic", () => {
    expect(normalizeTitle("Data Structures")).toBe(normalizeTitle("data structures"));
    expect(normalizeTitle("DATA STRUCTURES")).toBe(normalizeTitle("Data-Structures!"));
    expect(normalizeTitle("  Normalization  ")).toBe("normalization");
  });
});

describe("dedupeSyllabus", () => {
  it("drops duplicate topics within a unit but keeps distinct ones", () => {
    const out = dedupeSyllabus({
      subjects: [
        {
          name: "DBMS",
          units: [
            {
              name: "Unit 1",
              topics: [
                { name: "Normalization", difficulty: 3 },
                { name: "normalization", difficulty: 4 },
                { name: "Transactions", difficulty: 2 },
              ],
            },
          ],
        },
      ],
    });
    expect(out.subjects[0].units[0].topics.map((t) => t.name)).toEqual(["Normalization", "Transactions"]);
  });

  it("dedupes per unit, not across units", () => {
    const out = dedupeSyllabus({
      subjects: [
        {
          name: "S",
          units: [
            { name: "U1", topics: [{ name: "Intro", difficulty: 1 }] },
            { name: "U2", topics: [{ name: "Intro", difficulty: 1 }] },
          ],
        },
      ],
    });
    expect(out.subjects[0].units[0].topics).toHaveLength(1);
    expect(out.subjects[0].units[1].topics).toHaveLength(1);
  });
});

describe("heuristicConfident (AI gating)", () => {
  it("is confident with explicit unit structure", () => {
    expect(
      heuristicConfident({
        subjects: [{ name: "S", units: [{ name: "Unit 1", topics: [{ name: "A", difficulty: 3 }] }, { name: "Unit 2", topics: [{ name: "B", difficulty: 3 }] }] }],
      }),
    ).toBe(true);
  });

  it("is confident with a long flat topic list", () => {
    expect(
      heuristicConfident({
        subjects: [{ name: "S", units: [{ name: "Topics", topics: Array.from({ length: 9 }, (_, i) => ({ name: `T${i}`, difficulty: 3 })) }] }],
      }),
    ).toBe(true);
  });

  it("is not confident with a few stray topics (AI should disambiguate)", () => {
    expect(
      heuristicConfident({
        subjects: [{ name: "S", units: [{ name: "Topics", topics: [{ name: "A", difficulty: 3 }] }] }],
      }),
    ).toBe(false);
  });
});

describe("fingerprintBytes", () => {
  it("is deterministic and distinguishes content and size", () => {
    const a = fingerprintBytes(Buffer.from("hello"), 5);
    expect(fingerprintBytes(Buffer.from("hello"), 5)).toBe(a);
    expect(fingerprintBytes(Buffer.from("hello!"), 6)).not.toBe(a);
  });
});
