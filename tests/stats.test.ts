import { describe, expect, it } from "vitest";
import { currentStreak, longestStreak, productiveHourRange, completionRate } from "@/lib/engine/stats";
import { addDaysISO } from "@/lib/dates";

const TODAY = "2026-09-05";

describe("streaks", () => {
  it("counts a streak ending today when today is active", () => {
    const set = new Set([addDaysISO(0, TODAY), addDaysISO(-1, TODAY), addDaysISO(-2, TODAY), addDaysISO(-3, TODAY)]);
    expect(currentStreak(set, TODAY)).toBe(4);
  });

  it("counts back from yesterday when today is inactive", () => {
    const set = new Set([addDaysISO(-1, TODAY), addDaysISO(-2, TODAY), addDaysISO(-3, TODAY)]);
    expect(currentStreak(set, TODAY)).toBe(3);
  });

  it("breaks the streak at a gap", () => {
    const set = new Set([addDaysISO(-1, TODAY), addDaysISO(-3, TODAY), addDaysISO(-4, TODAY)]);
    expect(currentStreak(set, TODAY)).toBe(1);
  });

  it("finds the longest historical run", () => {
    const set = new Set([
      addDaysISO(-10, TODAY),
      addDaysISO(-9, TODAY),
      addDaysISO(-8, TODAY),
      addDaysISO(-2, TODAY),
    ]);
    expect(longestStreak(set)).toBe(3);
  });
});

describe("productiveHourRange", () => {
  it("picks the 3-hour window with the most study minutes", () => {
    const sessions = [
      { startedAt: "2026-09-01T19:00:00", durationMinutes: 60 },
      { startedAt: "2026-09-01T20:00:00", durationMinutes: 60 },
      { startedAt: "2026-09-01T21:00:00", durationMinutes: 60 },
      { startedAt: "2026-09-01T09:00:00", durationMinutes: 10 },
    ];
    const range = productiveHourRange(sessions);
    expect(range).not.toBeNull();
    expect(range!.label).toContain("7 PM");
  });

  it("returns null when there is no data", () => {
    expect(productiveHourRange([])).toBeNull();
  });
});

describe("completionRate", () => {
  it("computes percentages and guards division by zero", () => {
    expect(completionRate(3, 4)).toBe(75);
    expect(completionRate(0, 0)).toBe(0);
  });
});