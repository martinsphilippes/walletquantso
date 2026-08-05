import { describe, it, expect } from "vitest";
import { projectCashFlow } from "./project";
import type { Bill, Transaction } from "@/types";

function tx(p: Partial<Transaction>): Transaction {
  return {
    ownerId: "u",
    date: "2025-06-05",
    amount: 100,
    type: "expense",
    description: "",
    accountId: "a1",
    dedupHash: "h",
    createdAt: 0,
    ...p,
  };
}

function bill(p: Partial<Bill>): Bill {
  return {
    ownerId: "u",
    kind: "payable",
    description: "",
    amount: 100,
    dueDate: "2025-07-10",
    payments: [],
    createdAt: 0,
    ...p,
  };
}

describe("projectCashFlow", () => {
  const opts = { openingBalance: 1000, today: "2025-06-15", monthsAhead: 2 };

  it("buckets realized income/expense by month and ignores transfers", () => {
    const rows = projectCashFlow(
      [
        tx({ date: "2025-06-05", type: "income", amount: 500 }),
        tx({ date: "2025-06-20", type: "expense", amount: 200 }),
        tx({ date: "2025-06-25", type: "transfer", amount: 999, transferAccountId: "a2" }),
      ],
      [],
      opts,
    );
    const jun = rows.find((r) => r.month === "2025-06")!;
    expect(jun.realizedIn).toBe(500);
    expect(jun.realizedOut).toBe(200);
    expect(jun.net).toBe(300);
    expect(jun.balance).toBe(1300); // 1000 + 300
  });

  it("adds planned bill remainders in their due month", () => {
    const rows = projectCashFlow(
      [],
      [
        bill({ kind: "payable", amount: 100, dueDate: "2025-07-10" }),
        bill({ kind: "receivable", amount: 400, dueDate: "2025-07-20" }),
      ],
      opts,
    );
    const jul = rows.find((r) => r.month === "2025-07")!;
    expect(jul.plannedOut).toBe(100);
    expect(jul.plannedIn).toBe(400);
    expect(jul.net).toBe(300);
  });

  it("uses only the outstanding remainder of partially paid bills", () => {
    const rows = projectCashFlow(
      [],
      [bill({ kind: "payable", amount: 100, dueDate: "2025-07-10", payments: [{ id: "1", date: "x", amount: 60 }] })],
      opts,
    );
    expect(rows.find((r) => r.month === "2025-07")!.plannedOut).toBe(40);
  });

  it("surfaces overdue open bills in the current month", () => {
    const rows = projectCashFlow(
      [],
      [bill({ kind: "payable", amount: 100, dueDate: "2025-05-01" })], // past due
      opts,
    );
    expect(rows.find((r) => r.month === "2025-06")!.plannedOut).toBe(100);
  });

  it("rolls a running balance forward across months", () => {
    const rows = projectCashFlow(
      [tx({ date: "2025-06-01", type: "income", amount: 200 })],
      [bill({ kind: "payable", amount: 100, dueDate: "2025-07-10" })],
      opts,
    );
    const jun = rows.find((r) => r.month === "2025-06")!;
    const jul = rows.find((r) => r.month === "2025-07")!;
    expect(jun.balance).toBe(1200); // 1000 + 200
    expect(jul.balance).toBe(1100); // 1200 - 100
  });

  it("mode 'realized' ignores bills and appends no future months", () => {
    const rows = projectCashFlow(
      [tx({ date: "2025-06-01", type: "income", amount: 200 })],
      [bill({ kind: "payable", amount: 100, dueDate: "2025-07-10" })],
      { ...opts, mode: "realized" },
    );
    expect(rows.map((r) => r.month)).toEqual(["2025-06"]);
    const jun = rows[0];
    expect(jun.plannedOut).toBe(0);
    expect(jun.balance).toBe(1200); // só o realizado
  });
});
