import { describe, it, expect } from "vitest";
import { totalsByCategory, totalsByMonth, monthsPresent } from "./aggregate";
import type { Transaction } from "@/types";

function tx(p: Partial<Transaction>): Transaction {
  return {
    ownerId: "u",
    date: "2025-01-01",
    amount: 10,
    type: "expense",
    description: "",
    accountId: "a",
    dedupHash: "h",
    createdAt: 0,
    ...p,
  };
}

const data: Transaction[] = [
  tx({ type: "expense", amount: 100, categoryId: "food", date: "2025-01-05" }),
  tx({ type: "expense", amount: 50, categoryId: "food", date: "2025-01-10" }),
  tx({ type: "expense", amount: 200, categoryId: "rent", date: "2025-02-01" }),
  tx({ type: "expense", amount: 30, categoryId: null, date: "2025-02-02" }),
  tx({ type: "income", amount: 1000, categoryId: "salary", date: "2025-01-31" }),
];

describe("totalsByCategory", () => {
  it("sums expenses per category, sorted desc", () => {
    const r = totalsByCategory(data, "expense");
    // rent(200) > food(150) > uncategorized(30)
    expect(r[0]).toEqual({ categoryId: "rent", total: 200 });
    expect(r[1]).toEqual({ categoryId: "food", total: 150 });
  });

  it("groups uncategorized under null", () => {
    const r = totalsByCategory(data, "expense");
    expect(r.find((x) => x.categoryId === null)?.total).toBe(30);
  });

  it("separates income", () => {
    const r = totalsByCategory(data, "income");
    expect(r).toEqual([{ categoryId: "salary", total: 1000 }]);
  });
});

describe("totalsByMonth", () => {
  it("sums income and expense per month with balance", () => {
    const r = totalsByMonth(data);
    expect(r).toHaveLength(2);
    const jan = r.find((x) => x.month === "2025-01")!;
    expect(jan.expense).toBe(150);
    expect(jan.income).toBe(1000);
    expect(jan.balance).toBe(850);
    const feb = r.find((x) => x.month === "2025-02")!;
    expect(feb.expense).toBe(230);
    expect(feb.balance).toBe(-230);
  });

  it("is sorted ascending by month", () => {
    const r = totalsByMonth(data);
    expect(r.map((x) => x.month)).toEqual(["2025-01", "2025-02"]);
  });
});

describe("monthsPresent", () => {
  it("returns distinct months newest first", () => {
    expect(monthsPresent(data)).toEqual(["2025-02", "2025-01"]);
  });
});
