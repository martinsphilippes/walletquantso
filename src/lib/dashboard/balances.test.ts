import { describe, it, expect } from "vitest";
import { computeBalances } from "./balances";
import type { Account, Transaction } from "@/types";

function acc(id: string, initial: number): Account {
  return {
    id,
    ownerId: "u",
    name: id,
    type: "checking",
    initialBalance: initial,
    currency: "BRL",
    archived: false,
    createdAt: 0,
  };
}

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

describe("computeBalances", () => {
  it("applies income and expense to the account", () => {
    const r = computeBalances(
      [acc("a", 100)],
      [
        tx({ type: "income", amount: 50, accountId: "a" }),
        tx({ type: "expense", amount: 30, accountId: "a" }),
      ],
    );
    expect(r.balances[0].movements).toBe(20);
    expect(r.balances[0].current).toBe(120);
    expect(r.total).toBe(120);
  });

  it("moves money across accounts on a transfer", () => {
    const r = computeBalances(
      [acc("a", 100), acc("b", 0)],
      [tx({ type: "transfer", amount: 40, accountId: "a", transferAccountId: "b" })],
    );
    const a = r.balances.find((x) => x.accountId === "a")!;
    const b = r.balances.find((x) => x.accountId === "b")!;
    expect(a.current).toBe(60);
    expect(b.current).toBe(40);
    // Transfers are net-zero across the total.
    expect(r.total).toBe(100);
  });

  it("collects movements for unknown accounts", () => {
    const r = computeBalances(
      [acc("a", 0)],
      [tx({ type: "income", amount: 25, accountId: "ghost" })],
    );
    expect(r.unassignedMovements).toBe(25);
    expect(r.balances[0].current).toBe(0);
  });
});
