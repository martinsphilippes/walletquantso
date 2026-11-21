import { describe, it, expect } from "vitest";
import {
  billNameKey,
  classifyPatch,
  defaultLinkPeriod,
  linkCandidates,
  linkedPaymentsFor,
  linkSummary,
} from "./link";
import type { Bill, Transaction } from "@/types";

const bill = (p: Partial<Bill> = {}): Bill => ({
  id: "b1",
  ownerId: "u",
  kind: "receivable",
  description: "Qpaozinho — Mensal — 12% de R$ 293.949,57",
  amount: 35273.95,
  dueDate: "2026-11-09",
  competenceDate: "2026-11-09",
  categoryId: "cat-qp",
  costCenterId: "cc-qp",
  contactId: null,
  accountId: "cora",
  payments: [],
  createdAt: 0,
  ...p,
});

const tx = (id: string, p: Partial<Transaction> = {}): Transaction => ({
  id,
  ownerId: "u",
  date: "2026-10-10",
  amount: 1000,
  type: "income",
  description: "Pix recebido",
  accountId: "cora",
  dedupHash: "h",
  createdAt: 0,
  ...p,
});

describe("billNameKey", () => {
  it("pega o trecho antes do primeiro traço, normalizado", () => {
    expect(billNameKey("Qpaozinho — Mensal — 12% de R$ 1,00")).toBe("qpaozinho");
    expect(billNameKey("Philippe - Outdoor Luiz")).toBe("philippe");
    expect(billNameKey("Pão de Açúcar")).toBe("pao de acucar");
    expect(billNameKey("Xy — algo")).toBe("");
  });
});

describe("linkCandidates", () => {
  const txs = [
    tx("a", { date: "2026-10-05", description: "PIX RECEBIDO QPAOZINHO LTDA", amount: 10000 }),
    tx("b", { date: "2026-10-20", description: "Pix de cliente", amount: 5000 }),
    tx("c", { date: "2026-10-25", description: "Venda", categoryId: "cat-qp", amount: 3000 }),
    tx("d", { date: "2026-10-12", type: "expense", description: "Qpaozinho gasto" }),
    tx("e", { date: "2026-10-15", description: "Taxa Depix", feeOfId: "x" }),
    tx("f", { date: "2026-10-16", description: "Baixa de outro título", billId: "b2", billPaymentId: "p2" }),
    tx("g", { date: "2026-10-17", description: "Baixa de título apagado", billId: "sumiu", billPaymentId: "p9" }),
    tx("h", { date: "2026-09-01", description: "Qpaozinho setembro" }),
    tx("i", { date: "2026-10-18", description: "Baixa comum (marca perdida numa edição)" }),
    tx("j", { date: "2026-10-19", description: "Já abatido em outro título" }),
  ];
  const other: Bill = bill({
    id: "b2",
    description: "Outro cliente — Semanal",
    categoryId: "cat-outro",
    payments: [{ id: "p3", date: "2026-10-01", amount: 1, transactionId: "i" }],
  });
  const linkedOther: Bill = bill({
    id: "b3",
    description: "Outro cliente — Mensal",
    categoryId: "cat-outro",
    payments: [{ id: "p4", date: "2026-10-01", amount: 1, transactionId: "j", linked: true }],
  });

  it("receitas sem taxa; sugeridos, depois livres, depois baixas de outros títulos", () => {
    const list = linkCandidates(bill(), txs, [bill(), other, linkedOther], { from: "2026-10-01", to: "2026-11-09" });
    expect(list.map((c) => c.tx.id)).toEqual(["c", "a", "b", "g", "i", "f"]);
    expect(list.filter((c) => c.suggested).map((c) => c.tx.id)).toEqual(["c", "a"]);
    // Baixa comum de outro título entra, identificada; título apagado = livre.
    expect(list.find((c) => c.tx.id === "i")?.paidBy?.id).toBe("b2");
    expect(list.find((c) => c.tx.id === "f")?.paidBy?.id).toBe("b2");
    expect(list.find((c) => c.tx.id === "g")?.paidBy).toBeUndefined();
    // O que já abate outro título (baixa vinculada) não pode abater este.
    expect(list.some((c) => c.tx.id === "j")).toBe(false);
  });

  it("mensal do Qpaozinho: os semanais já recebidos aparecem como sugeridos", () => {
    const mensal = bill({ id: "mensal" });
    const semanal = bill({
      id: "sem1",
      description: "Qpaozinho — Semanal — 12% de R$ 54.125,00",
      amount: 6495,
      dueDate: "2026-10-13",
      payments: [{ id: "pw", date: "2026-10-14", amount: 6495, transactionId: "w1" }],
    });
    const recebido = tx("w1", {
      date: "2026-10-14",
      amount: 6495,
      description: "Qpaozinho — Semanal — 12% de R$ 54.125,00",
      billId: "sem1",
      billPaymentId: "pw",
      categoryId: "cat-qp",
    });
    const list = linkCandidates(mensal, [recebido], [mensal, semanal], { from: "2026-10-01", to: "2026-11-21" });
    expect(list).toEqual([{ tx: recebido, suggested: true, paidBy: semanal }]);
    // Depois de abatido no mensal, some da lista (não abate duas vezes).
    const abatido = bill({ ...mensal, payments: [{ id: "x", date: "2026-10-14", amount: 6495, transactionId: "w1", linked: true }] });
    expect(linkCandidates(abatido, [recebido], [abatido, semanal])).toEqual([]);
  });

  it("sem período lista tudo; busca por texto ou valor; filtro de conta", () => {
    expect(linkCandidates(bill(), txs, [bill(), other]).map((c) => c.tx.id)).toContain("h");
    expect(linkCandidates(bill(), txs, [bill()], { query: "qpao" }).map((c) => c.tx.id)).toEqual(["a", "h"]);
    expect(linkCandidates(bill(), txs, [bill()], { query: "5.000" }).map((c) => c.tx.id)).toEqual(["b"]);
    expect(linkCandidates(bill(), txs, [bill()], { query: "5000" }).map((c) => c.tx.id)).toEqual(["b"]);
    expect(linkCandidates(bill(), txs, [bill()], { accountId: "c6" })).toEqual([]);
  });

  it("conta a pagar procura despesas; lançamento já abatido no próprio título some", () => {
    const pay = bill({ kind: "payable", payments: [{ id: "p", date: "2026-10-01", amount: 1, transactionId: "d" }] });
    expect(linkCandidates(pay, txs, [pay])).toEqual([]);
    expect(linkCandidates(bill({ kind: "payable" }), txs, []).map((c) => c.tx.id)).toEqual(["d"]);
  });
});

describe("linkedPaymentsFor / linkSummary / classifyPatch", () => {
  it("uma baixa por lançamento, apontando para ele e marcada como vinculada", () => {
    let n = 0;
    const ps = linkedPaymentsFor([tx("a", { amount: 10.006, date: "2026-10-05" })], () => `p${++n}`);
    expect(ps).toEqual([
      { id: "p1", date: "2026-10-05", amount: 10.01, accountId: "cora", transactionId: "a", linked: true },
    ]);
  });

  it("abate do saldo; o que passar do saldo aparece como excedente", () => {
    const b = bill({ amount: 1000, payments: [{ id: "x", date: "2026-10-01", amount: 200 }] });
    expect(linkSummary(b, [tx("a", { amount: 300 }), tx("b", { amount: 100 })])).toEqual({
      count: 2,
      total: 400,
      remainingBefore: 800,
      remainingAfter: 400,
      excess: 0,
    });
    expect(linkSummary(b, [tx("a", { amount: 900 })])).toMatchObject({ remainingAfter: 0, excess: 100 });
  });

  it("só preenche categoria, centro e contato vazios", () => {
    expect(classifyPatch(tx("a"), bill({ contactId: "ct" }))).toEqual({
      categoryId: "cat-qp",
      costCenterId: "cc-qp",
      contactId: "ct",
    });
    expect(classifyPatch(tx("a", { categoryId: "outra", costCenterId: "outro" }), bill())).toEqual({});
  });
});

describe("defaultLinkPeriod", () => {
  it("do 1º dia do mês anterior ao título até o vencimento (ou hoje, se já passou)", () => {
    expect(defaultLinkPeriod(bill(), "2026-11-09")).toEqual({ from: "2026-10-01", to: "2026-11-09" });
    expect(defaultLinkPeriod(bill(), "2026-11-20")).toEqual({ from: "2026-10-01", to: "2026-11-20" });
    expect(defaultLinkPeriod(bill({ dueDate: "2026-01-10", competenceDate: null }), "2026-01-05")).toEqual({
      from: "2025-12-01",
      to: "2026-01-10",
    });
    expect(defaultLinkPeriod(bill({ competenceDate: "2026-10-31" }), "2026-11-09").from).toBe("2026-09-01");
  });
});
