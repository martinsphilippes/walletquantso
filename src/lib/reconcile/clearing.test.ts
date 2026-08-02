import { describe, it, expect } from "vitest";
import { movementFor, transactionsForAccount, summarizeClearing } from "./clearing";
import type { Account, Transaction } from "@/types";

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

const account: Account = {
  id: "a1",
  ownerId: "u",
  name: "Conta",
  type: "checking",
  initialBalance: 1000,
  currency: "BRL",
  archived: false,
  createdAt: 0,
};

describe("movementFor", () => {
  it("signs income/expense on the account", () => {
    expect(movementFor(tx({ type: "income", amount: 50 }), "a1")).toBe(50);
    expect(movementFor(tx({ type: "expense", amount: 50 }), "a1")).toBe(-50);
  });
  it("handles both legs of a transfer", () => {
    const t = tx({ type: "transfer", amount: 200, accountId: "a1", transferAccountId: "a2" });
    expect(movementFor(t, "a1")).toBe(-200);
    expect(movementFor(t, "a2")).toBe(200);
  });
  it("returns 0 for unrelated accounts", () => {
    expect(movementFor(tx({ accountId: "a1" }), "a2")).toBe(0);
  });
});

describe("transactionsForAccount", () => {
  it("keeps only entries touching the account", () => {
    const txs = [
      tx({ accountId: "a1" }),
      tx({ accountId: "a2" }),
      tx({ type: "transfer", accountId: "a3", transferAccountId: "a1" }),
    ];
    expect(transactionsForAccount(txs, "a1").length).toBe(2);
  });
});

describe("summarizeClearing", () => {
  it("splits cleared vs pending balances", () => {
    const txs = [
      tx({ type: "income", amount: 500, reconciled: true }),
      tx({ type: "expense", amount: 200, reconciled: true }),
      tx({ type: "expense", amount: 80, reconciled: false }),
    ];
    const s = summarizeClearing(account, txs);
    expect(s.clearedBalance).toBe(1300); // 1000 + 500 - 200
    expect(s.currentBalance).toBe(1220); // 1300 - 80
    expect(s.pendingAmount).toBe(-80);
    expect(s.pendingCount).toBe(1);
    expect(s.clearedCount).toBe(2);
  });

  it("ignores transactions from other accounts", () => {
    const s = summarizeClearing(account, [tx({ accountId: "other", amount: 999 })]);
    expect(s.currentBalance).toBe(1000);
    expect(s.pendingCount).toBe(0);
  });
});
