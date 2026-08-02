import { describe, it, expect } from "vitest";
import { filterTransactions, summarize } from "./filter";
import type { Transaction } from "@/types";

function tx(p: Partial<Transaction>): Transaction {
  return {
    ownerId: "u",
    date: "2025-01-01",
    amount: 10,
    type: "expense",
    description: "",
    accountId: "acc1",
    dedupHash: "h",
    createdAt: 0,
    ...p,
  };
}

const data: Transaction[] = [
  tx({ description: "Mercado", amount: 50, type: "expense", accountId: "acc1", date: "2025-01-05" }),
  tx({ description: "Salário", amount: 1000, type: "income", accountId: "acc1", date: "2025-01-10" }),
  tx({ description: "Café", amount: 5, type: "expense", accountId: "acc2", date: "2025-02-01" }),
  tx({
    description: "Transferência",
    amount: 200,
    type: "transfer",
    accountId: "acc1",
    transferAccountId: "acc2",
    date: "2025-01-15",
  }),
];

describe("filterTransactions", () => {
  it("filters by text (accent/case-insensitive)", () => {
    expect(filterTransactions(data, { text: "cafe" }).length).toBe(1);
    expect(filterTransactions(data, { text: "MERCADO" }).length).toBe(1);
  });

  it("filters by account including transfer destination", () => {
    // acc2 appears as source of "Café" and destination of the transfer.
    expect(filterTransactions(data, { accountId: "acc2" }).length).toBe(2);
  });

  it("filters by type", () => {
    expect(filterTransactions(data, { type: "income" }).length).toBe(1);
    expect(filterTransactions(data, { type: "transfer" }).length).toBe(1);
  });

  it("filters by date range inclusively", () => {
    expect(filterTransactions(data, { from: "2025-01-01", to: "2025-01-31" }).length).toBe(3);
    expect(filterTransactions(data, { from: "2025-02-01" }).length).toBe(1);
  });

  it("combines filters", () => {
    expect(filterTransactions(data, { accountId: "acc1", type: "expense" }).length).toBe(1);
  });

  it("filters by category, cost center and contact", () => {
    const tagged: Transaction[] = [
      tx({ description: "A", categoryId: "cat1", costCenterId: "cc1", contactId: "p1" }),
      tx({ description: "B", categoryId: "cat2", costCenterId: "cc1", contactId: "p2" }),
      tx({ description: "C", categoryId: "cat1", costCenterId: "cc2", contactId: "p1" }),
    ];
    expect(filterTransactions(tagged, { categoryId: "cat1" }).length).toBe(2);
    expect(filterTransactions(tagged, { costCenterId: "cc1" }).length).toBe(2);
    expect(filterTransactions(tagged, { contactId: "p1" }).length).toBe(2);
    expect(
      filterTransactions(tagged, { categoryId: "cat1", contactId: "p1" }).length,
    ).toBe(2);
    expect(
      filterTransactions(tagged, { categoryId: "cat1", costCenterId: "cc2" }).length,
    ).toBe(1);
  });
});

describe("summarize", () => {
  it("totals income and expense, excluding transfers", () => {
    const s = summarize(data);
    expect(s.income).toBe(1000);
    expect(s.expense).toBe(55);
    expect(s.balance).toBe(945);
    expect(s.count).toBe(4);
  });
});
