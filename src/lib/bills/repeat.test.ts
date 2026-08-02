import { describe, it, expect } from "vitest";
import { addMonthsIso, splitAmount, expandRepeat } from "./repeat";

describe("addMonthsIso", () => {
  it("advances the month keeping the day", () => {
    expect(addMonthsIso("2026-01-15", 1)).toBe("2026-02-15");
    expect(addMonthsIso("2026-01-15", 12)).toBe("2027-01-15");
  });
  it("clamps to the last day of a shorter month", () => {
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsIso("2026-01-31", 3)).toBe("2026-04-30");
  });
});

describe("splitAmount", () => {
  it("splits evenly when divisible", () => {
    expect(splitAmount(100, 4)).toEqual([25, 25, 25, 25]);
  });
  it("distributes the remainder cents to the first parcelas and sums exactly", () => {
    const parts = splitAmount(100, 3); // 100/3
    expect(parts).toEqual([33.34, 33.33, 33.33]);
    const sum = Math.round(parts.reduce((s, p) => s + p, 0) * 100) / 100;
    expect(sum).toBe(100);
  });
});

describe("expandRepeat", () => {
  const base = { amount: 100, dueDate: "2026-08-10", competenceDate: "2026-08-10" };

  it("single returns one title with the full value", () => {
    const out = expandRepeat(base, "single");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ amount: 100, dueDate: "2026-08-10", installment: null });
  });

  it("fixed repeats the same value monthly for N occurrences", () => {
    const out = expandRepeat(base, "fixed", 3);
    expect(out).toHaveLength(3);
    expect(out.map((o) => o.amount)).toEqual([100, 100, 100]);
    expect(out.map((o) => o.dueDate)).toEqual(["2026-08-10", "2026-09-10", "2026-10-10"]);
    expect(out.every((o) => o.installment === null)).toBe(true);
  });

  it("installments splits the total across N monthly parcelas", () => {
    const out = expandRepeat(base, "installments", 3);
    expect(out).toHaveLength(3);
    expect(out.map((o) => o.amount)).toEqual([33.34, 33.33, 33.33]);
    expect(out.map((o) => o.dueDate)).toEqual(["2026-08-10", "2026-09-10", "2026-10-10"]);
    expect(out[0].installment).toEqual({ number: 1, total: 3 });
    expect(out[2].installment).toEqual({ number: 3, total: 3 });
    const sum = Math.round(out.reduce((s, o) => s + o.amount, 0) * 100) / 100;
    expect(sum).toBe(100);
  });
});
