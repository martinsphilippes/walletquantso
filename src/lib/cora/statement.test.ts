import { describe, it, expect } from "vitest";
import { normalizeCoraStatement, describeEntry, type CoraEntry } from "./statement";

function entry(p: Partial<CoraEntry>): CoraEntry {
  return {
    id: "ent_1",
    type: "DEBIT",
    amount: 1500,
    createdAt: "2026-04-06T09:00:00+00",
    ...p,
  };
}

describe("normalizeCoraStatement", () => {
  it("maps CREDIT to income and DEBIT to expense, converting cents to BRL", () => {
    const res = {
      entries: [
        entry({ id: "a", type: "CREDIT", amount: 24230, createdAt: "2026-04-06T09:00:00+00" }),
        entry({ id: "b", type: "DEBIT", amount: 1500, createdAt: "2026-04-07T10:00:00+00" }),
      ],
    };
    const out = normalizeCoraStatement(res);
    expect(out).toEqual([
      { externalId: "cora:a", date: "2026-04-06", amount: 242.3, type: "income", description: "Movimentação Cora" },
      { externalId: "cora:b", date: "2026-04-07", amount: 15, type: "expense", description: "Movimentação Cora" },
    ]);
  });

  it("ignores BLOCK/UNBLOCK holds and non-positive amounts", () => {
    const res = {
      entries: [
        entry({ id: "a", type: "BLOCK", amount: 5000 }),
        entry({ id: "b", type: "UNBLOCK", amount: 5000 }),
        entry({ id: "c", type: "DEBIT", amount: 0 }),
      ],
    };
    expect(normalizeCoraStatement(res)).toEqual([]);
  });

  it("builds a description from transaction description and counterparty", () => {
    const e = entry({
      transaction: { description: "Pagamento", counterParty: { name: "Fornecedor X" } },
    });
    expect(describeEntry(e)).toBe("Pagamento — Fornecedor X");
  });

  it("uses only the counterparty when there is no description", () => {
    const e = entry({ transaction: { counterParty: { name: "Cliente Y" } } });
    expect(describeEntry(e)).toBe("Cliente Y");
  });

  it("handles an empty statement", () => {
    expect(normalizeCoraStatement({})).toEqual([]);
  });

  it("uses Brazil's timezone for the date (a night movement stays on its local day)", () => {
    // 28/07 at 21:30 in Brazil = 29/07 00:30 UTC — must come out as 28/07.
    const res = {
      entries: [entry({ id: "n", type: "CREDIT", amount: 300000, createdAt: "2026-07-29T00:30:00+00" })],
    };
    const [out] = normalizeCoraStatement(res);
    expect(out.date).toBe("2026-07-28");
    expect(out.amount).toBe(3000);
  });
});
