import { describe, it, expect } from "vitest";
import { donutSegments, cumulativeBalance } from "./charts";
import type { MonthTotal } from "./aggregate";

describe("donutSegments", () => {
  it("computes fractions and cumulative offsets", () => {
    const s = donutSegments([25, 25, 50]);
    expect(s[0]).toEqual({ fraction: 0.25, offset: 0 });
    expect(s[1]).toEqual({ fraction: 0.25, offset: 0.25 });
    expect(s[2]).toEqual({ fraction: 0.5, offset: 0.5 });
  });

  it("handles all-zero input without dividing by zero", () => {
    const s = donutSegments([0, 0]);
    expect(s.every((x) => x.fraction === 0)).toBe(true);
  });

  it("ignores negatives", () => {
    const s = donutSegments([-10, 10]);
    expect(s[1].fraction).toBe(1);
  });
});

describe("cumulativeBalance", () => {
  it("accumulates month balances", () => {
    const months: MonthTotal[] = [
      { month: "2025-01", income: 100, expense: 40, balance: 60 },
      { month: "2025-02", income: 0, expense: 100, balance: -100 },
      { month: "2025-03", income: 50, expense: 0, balance: 50 },
    ];
    const r = cumulativeBalance(months);
    expect(r.map((x) => x.cumulative)).toEqual([60, -40, 10]);
  });

  it("returns empty for no months", () => {
    expect(cumulativeBalance([])).toEqual([]);
  });
});
