import { describe, it, expect } from "vitest";
import { namesMatch, planAutoProcess } from "./autoprocess";
import type { Bill, Transaction } from "@/types";
import type { NormalizedEntry } from "./statement";

const ACC = "cora1";

function tx(p: Partial<Transaction>): Transaction {
  return {
    id: `tx-${Math.random()}`,
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

function bill(p: Partial<Bill>): Bill {
  return {
    id: `b-${Math.random()}`,
    ownerId: "u",
    kind: "payable",
    description: "b",
    amount: 100,
    dueDate: "2026-08-01",
    payments: [],
    createdAt: 0,
    ...p,
  };
}

describe("namesMatch", () => {
  it("matches by two shared significant tokens, ignoring case/accents/noise", () => {
    expect(namesMatch("PIX GABRIEL CHAVES", "Gabriel Chaves - Comissionamento")).toBe(true);
  });
  it("matches a single long identity token", () => {
    expect(namesMatch("Mensalidade CEMIG agosto", "CEMIG")).toBe(true);
  });
  it("does not match unrelated names or generic banking words", () => {
    expect(namesMatch("PIX Maria Jose", "Aluguel Alphaville")).toBe(false);
    expect(namesMatch("Pagamento PIX", "Pagamento boleto")).toBe(false);
  });
});

describe("planAutoProcess", () => {
  it("merges duplicate pairs, preserving the Meu Dinheiro record", () => {
    const e = entry({ externalId: "cora:a" });
    const coraCopy = tx({ externalId: "cora:a" });
    const original = tx({ description: "do Meu Dinheiro", categoryId: "cat1" });
    const [a] = planAutoProcess([e], [coraCopy, original], [], ACC);
    expect(a).toMatchObject({ kind: "merge", keep: original, removeId: coraCopy.id });
  });

  it("links an existing unlinked lançamento instead of creating another", () => {
    const e = entry({ externalId: "cora:b", amount: 55, type: "income", date: "2026-08-02" });
    const original = tx({ type: "income", amount: 55, date: "2026-08-02" });
    const [a] = planAutoProcess([e], [original], [], ACC);
    expect(a).toMatchObject({ kind: "link", keep: original });
  });

  it("skips movements already linked", () => {
    const e = entry({ externalId: "cora:c" });
    const linked = tx({ externalId: "cora:c" });
    const [a] = planAutoProcess([e], [linked], [], ACC);
    expect(a).toMatchObject({ kind: "skip" });
  });

  it("settles the open payable with the most similar name (closest due date wins)", () => {
    const e = entry({ description: "PIX Gabriel Chaves", amount: 500, date: "2026-08-03" });
    const far = bill({ description: "Gabriel Chaves - Comissionamento", dueDate: "2026-09-20" });
    const near = bill({ description: "Gabriel Chaves - Comissionamento", dueDate: "2026-08-05" });
    const [a] = planAutoProcess([e], [], [far, near], ACC);
    expect(a).toMatchObject({ kind: "settleBill", bill: near });
  });

  it("creates a new lançamento when nothing matches (and never bill-matches credits)", () => {
    const debit = entry({ description: "Compra qualquer", amount: 10 });
    const credit = entry({ description: "Gabriel Chaves", amount: 20, type: "income" });
    const b = bill({ description: "Gabriel Chaves - Comissionamento" });
    const actions = planAutoProcess([debit, credit], [], [b], ACC);
    expect(actions.every((a) => a.kind === "create")).toBe(true);
  });

  it("does not settle already-paid títulos", () => {
    const e = entry({ description: "PIX Gabriel Chaves", amount: 500 });
    const paid = bill({
      description: "Gabriel Chaves - Comissionamento",
      amount: 500,
      payments: [{ id: "p", date: "2026-07-01", amount: 500 }],
    });
    const [a] = planAutoProcess([e], [], [paid], ACC);
    expect(a).toMatchObject({ kind: "create" });
  });
});
