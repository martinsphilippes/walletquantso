import { describe, it, expect } from "vitest";
import { computeOverview } from "./overview";
import type { Account, Bill, Transaction } from "@/types";

const TODAY = "2026-08-02";

function account(initialBalance: number, id = "a1"): Account {
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
  paid: number[] = [],
): Bill {
  return {
    ownerId: "u1",
    kind,
    description: "b",
    amount,
    dueDate,
    payments: paid.map((a, i) => ({ id: String(i), date: "2026-08-01", amount: a })),
    createdAt: 0,
  };
}

describe("computeOverview", () => {
  it("is all-zero for an empty account with no data", () => {
    const o = computeOverview([account(0)], [], [], [], TODAY);
    expect(o).toMatchObject({
      initialBalance: 0,
      realizedIncome: 0,
      realizedExpense: 0,
      currentBalance: 0,
      toReceive: 0,
      toPay: 0,
      projectedBalance: 0,
      overdue: 0,
      pendingCount: 0,
    });
  });

  it("sums account opening balances into the current balance", () => {
    const o = computeOverview([account(100, "a1"), account(50, "a2")], [], [], [], TODAY);
    expect(o.initialBalance).toBe(150);
    expect(o.currentBalance).toBe(150);
    expect(o.projectedBalance).toBe(150);
  });

  it("counts income and expense transactions as realized", () => {
    const o = computeOverview(
      [account(0)],
      [tx("income", 200), tx("expense", 30)],
      [],
      [],
      TODAY,
    );
    expect(o.realizedIncome).toBe(200);
    expect(o.realizedExpense).toBe(30);
    expect(o.currentBalance).toBe(170);
  });

  it("ignores transfers for total cash (net zero)", () => {
    const o = computeOverview([account(0)], [tx("transfer", 500)], [], [], TODAY);
    expect(o.realizedIncome).toBe(0);
    expect(o.realizedExpense).toBe(0);
    expect(o.currentBalance).toBe(0);
  });

  it("treats a paid receivable as realized income and leaves nothing to receive", () => {
    const o = computeOverview([account(0)], [], [], [bill("receivable", 100, "2026-08-10", [100])], TODAY);
    expect(o.realizedIncome).toBe(100);
    expect(o.toReceive).toBe(0);
    expect(o.currentBalance).toBe(100);
    expect(o.pendingCount).toBe(0);
  });

  it("treats a paid payable as realized expense and leaves nothing to pay", () => {
    const o = computeOverview([account(0)], [], [bill("payable", 100, "2026-08-10", [100])], [], TODAY);
    expect(o.realizedExpense).toBe(100);
    expect(o.toPay).toBe(0);
    expect(o.currentBalance).toBe(-100);
  });

  it("splits a partially paid payable into realized (paid) and planned (remaining)", () => {
    const o = computeOverview([account(0)], [], [bill("payable", 100, "2026-08-10", [40])], [], TODAY);
    expect(o.realizedExpense).toBe(40);
    expect(o.toPay).toBe(60);
    expect(o.pendingCount).toBe(1);
    expect(o.currentBalance).toBe(-40);
    expect(o.projectedBalance).toBe(-100);
  });

  it("computes the projected balance from open bills", () => {
    const o = computeOverview(
      [account(100)],
      [],
      [bill("payable", 30, "2026-09-01")],
      [bill("receivable", 80, "2026-09-01")],
      TODAY,
    );
    expect(o.currentBalance).toBe(100);
    expect(o.toReceive).toBe(80);
    expect(o.toPay).toBe(30);
    expect(o.projectedBalance).toBe(150);
    expect(o.pendingCount).toBe(2);
  });

  it("flags outstanding amounts past their due date as overdue", () => {
    const o = computeOverview(
      [account(0)],
      [],
      [bill("payable", 100, "2026-07-01")], // past due
      [bill("receivable", 50, "2026-09-01")], // future
      TODAY,
    );
    expect(o.overdue).toBe(100);
    expect(o.toPay).toBe(100);
    expect(o.toReceive).toBe(50);
  });

  it("does not double count a payment already materialized as a transaction", () => {
    // The baixa is now a real income transaction; the receivable's payment
    // carries its transactionId. Only one of them must count.
    const paidBill = bill("receivable", 100, "2026-08-10", [100]);
    paidBill.payments[0].transactionId = "tx-1";
    const o = computeOverview(
      [account(0)],
      [tx("income", 100, { billId: paidBill.id, billPaymentId: "0" })],
      [],
      [paidBill],
      TODAY,
    );
    expect(o.realizedIncome).toBe(100); // not 200
    expect(o.toReceive).toBe(0);
    expect(o.currentBalance).toBe(100);
  });
});
