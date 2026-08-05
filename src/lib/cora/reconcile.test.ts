import { describe, it, expect } from "vitest";
import { compareWithCora, signedForAccount } from "./reconcile";
import type { Transaction } from "@/types";
import type { NormalizedEntry } from "./statement";

const ACC = "cora1";

function tx(p: Partial<Transaction>): Transaction {
  return {
    ownerId: "u",
    date: "2026-08-01",
    amount: 100,
    type: "expense",
    description: "t",
    accountId: ACC,
    dedupHash: Math.random().toString(),
    createdAt: 0,
    ...p,
  };
}

function entry(p: Partial<NormalizedEntry>): NormalizedEntry {
  return {
    externalId: `cora:${Math.random()}`,
    date: "2026-08-01",
    amount: 100,
    type: "expense",
    description: "e",
    ...p,
  };
}

describe("signedForAccount", () => {
  it("signs income/expense/transfer relative to the account", () => {
    expect(signedForAccount(tx({ type: "income", amount: 50 }), ACC)).toBe(50);
    expect(signedForAccount(tx({ type: "expense", amount: 50 }), ACC)).toBe(-50);
    expect(signedForAccount(tx({ type: "transfer", amount: 50, transferAccountId: "x" }), ACC)).toBe(-50);
    expect(
      signedForAccount(tx({ type: "transfer", amount: 50, accountId: "x", transferAccountId: ACC }), ACC),
    ).toBe(50);
    expect(signedForAccount(tx({ accountId: "other" }), ACC)).toBe(0);
  });
});

describe("compareWithCora", () => {
  it("flags the non-Cora surplus entry as duplicate, keeping the imported one", () => {
    const e = entry({ externalId: "cora:a", amount: 100 });
    const imported = tx({ externalId: "cora:a" });
    const old = tx({ description: "veio do Meu Dinheiro" });
    const r = compareWithCora([e], [imported, old], ACC, "2026-08-01", "2026-08-05");
    expect(r.duplicates).toEqual([old]);
    expect(r.walletOnly).toEqual([]);
    expect(r.coraOnly).toEqual([]);
  });

  it("does not flag N identical movements when the bank also has N", () => {
    const es = [entry({ amount: 100 }), entry({ amount: 100 })];
    const ts = [tx({}), tx({})];
    const r = compareWithCora(es, ts, ACC, "2026-08-01", "2026-08-05");
    expect(r.duplicates).toEqual([]);
    expect(r.coraOnly).toEqual([]);
  });

  it("reports wallet-only and cora-only movements", () => {
    const r = compareWithCora(
      [entry({ amount: 70, type: "income", date: "2026-08-02" })],
      [tx({ amount: 33, date: "2026-08-03" })],
      ACC,
      "2026-08-01",
      "2026-08-05",
    );
    expect(r.coraOnly).toHaveLength(1);
    expect(r.walletOnly).toHaveLength(1);
    expect(r.coraNet).toBe(70);
    expect(r.walletNet).toBe(-33);
  });

  it("ignores movements outside the period or on other accounts", () => {
    const r = compareWithCora(
      [],
      [tx({ date: "2026-07-01" }), tx({ accountId: "other" })],
      ACC,
      "2026-08-01",
      "2026-08-05",
    );
    expect(r.walletOnly).toEqual([]);
    expect(r.walletNet).toBe(0);
  });
});
