import { describe, it, expect } from "vitest";
import { computeCashBalances, monthResult } from "./cash";
import type { Account, Bill, Transaction } from "@/types";

function account(initialBalance: number, id: string): Account {
  return {
    id,
    ownerId: "u1",
    name: id,
    type: "checking",
    initialBalance,
    currency: "BRL",
    archived: false,
    createdAt: 0,
  };
}

function tx(type: Transaction["type"], amount: number, extra: Partial<Transaction> = {}): Transaction {
  return {
    ownerId: "u1",
    date: "2026-08-01",
    amount,
    type,
    description: "t",
    accountId: "a1",
    dedupHash: Math.random().toString(),
    createdAt: 0,
    ...extra,
  };
}

function bill(
  kind: Bill["kind"],
  amount: number,
  dueDate: string,
  payments: Array<{ amount: number; date?: string; accountId?: string | null }> = [],
  extra: Partial<Bill> = {},
): Bill {
  return {
    ownerId: "u1",
    kind,
    description: "b",
    amount,
    dueDate,
    payments: payments.map((p, i) => ({
      id: String(i),
      date: p.date ?? "2026-08-01",
      amount: p.amount,
      accountId: p.accountId ?? null,
    })),
    createdAt: 0,
    ...extra,
  };
}

describe("computeCashBalances", () => {
  it("starts from account opening balances", () => {
    const r = computeCashBalances([account(100, "a1"), account(50, "a2")], [], [], []);
    expect(r.totalConfirmed).toBe(150);
    expect(r.totalProjected).toBe(150);
    expect(r.rows).toHaveLength(2);
  });

  it("applies transaction movements to confirmed and projected", () => {
    const r = computeCashBalances(
      [account(0, "a1")],
      [tx("income", 200), tx("expense", 30)],
      [],
      [],
    );
    const a1 = r.rows.find((x) => x.accountId === "a1")!;
    expect(a1.confirmed).toBe(170);
    expect(a1.projected).toBe(170);
  });

  it("moves money between accounts on a transfer", () => {
    const r = computeCashBalances(
      [account(100, "a1"), account(0, "a2")],
      [tx("transfer", 40, { accountId: "a1", transferAccountId: "a2" })],
      [],
      [],
    );
    expect(r.rows.find((x) => x.accountId === "a1")!.confirmed).toBe(60);
    expect(r.rows.find((x) => x.accountId === "a2")!.confirmed).toBe(40);
    expect(r.totalConfirmed).toBe(100);
  });

  it("counts a bill settlement as confirmed and the remainder as projected only", () => {
    const r = computeCashBalances(
      [account(0, "a1")],
      [],
      [],
      [bill("receivable", 100, "2026-08-10", [{ amount: 40, accountId: "a1" }], { accountId: "a1" })],
    );
    const a1 = r.rows.find((x) => x.accountId === "a1")!;
    expect(a1.confirmed).toBe(40); // received so far
    expect(a1.projected).toBe(100); // 40 received + 60 still open
  });

  it("subtracts payable settlements and open remainder", () => {
    const r = computeCashBalances(
      [account(100, "a1")],
      [],
      [bill("payable", 30, "2026-08-10", [], { accountId: "a1" })],
      [],
    );
    const a1 = r.rows.find((x) => x.accountId === "a1")!;
    expect(a1.confirmed).toBe(100);
    expect(a1.projected).toBe(70);
  });

  it("buckets account-less amounts under 'Sem conta'", () => {
    const r = computeCashBalances(
      [],
      [],
      [],
      [bill("receivable", 80, "2026-08-10")],
    );
    const none = r.rows.find((x) => x.accountId === null)!;
    expect(none.name).toBe("Sem conta");
    expect(none.projected).toBe(80);
    expect(none.confirmed).toBe(0);
  });
});

describe("monthResult", () => {
  it("sums income and expense transactions dated in the month", () => {
    const r = monthResult(
      [tx("income", 200, { date: "2026-08-05" }), tx("expense", 50, { date: "2026-08-20" }), tx("income", 999, { date: "2026-07-30" })],
      [],
      [],
      "2026-08",
    );
    expect(r.income).toBe(200);
    expect(r.expense).toBe(50);
    expect(r.result).toBe(150);
  });

  it("includes open bills due in the month and settlements made in the month", () => {
    const r = monthResult(
      [],
      [bill("payable", 100, "2026-08-15")],
      [bill("receivable", 300, "2026-08-10", [{ amount: 100, date: "2026-08-02" }])],
      "2026-08",
    );
    // receivable: 100 settled in-month + 200 remaining due in-month = 300
    expect(r.income).toBe(300);
    expect(r.expense).toBe(100);
    expect(r.result).toBe(200);
  });

  it("mode 'realized' counts only money that actually moved in the month", () => {
    const r = monthResult(
      [tx("income", 200, { date: "2026-08-05" })],
      [bill("payable", 100, "2026-08-15")], // open — projected only
      [bill("receivable", 300, "2026-08-10", [{ amount: 100, date: "2026-08-02" }])],
      "2026-08",
      "realized",
    );
    // 200 (tx) + 100 (settled part); the open 200 remaining and the open payable are out.
    expect(r.income).toBe(300);
    expect(r.expense).toBe(0);
    expect(r.result).toBe(300);
  });

  it("ignores bills due in other months", () => {
    const r = monthResult([], [bill("payable", 100, "2026-09-15")], [], "2026-08");
    expect(r.expense).toBe(0);
  });
});
