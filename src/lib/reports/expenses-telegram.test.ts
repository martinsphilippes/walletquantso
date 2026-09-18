import { describe, it, expect } from "vitest";
import { buildExpensesMessages, spendByCategory } from "./expenses-telegram";
import type { Category, Transaction } from "@/types";

const cat = (id: string, name: string, p: Partial<Category> = {}): Category => ({
  id,
  ownerId: "u",
  name,
  kind: "expense",
  parentId: null,
  createdAt: 0,
  ...p,
});

const tx = (p: Partial<Transaction>): Transaction => ({
  ownerId: "u",
  date: "2026-09-10",
  amount: 10,
  type: "expense",
  description: "x",
  accountId: "a",
  dedupHash: "h",
  createdAt: 0,
  ...p,
});

const categories = [
  cat("comb", "Combustível"),
  cat("mot", "Motoristas"),
  cat("mot-d", "Diárias", { parentId: "mot" }),
  cat("mot-c", "Corridas", { parentId: "mot" }),
  cat("alu", "Aluguel"),
  cat("venda", "Vendas", { kind: "income" }),
];

describe("spendByCategory", () => {
  it("soma o mês até hoje por categoria-mãe, com subcategorias, e lista as sem gasto", () => {
    const txs = [
      tx({ categoryId: "comb", amount: 100 }),
      tx({ categoryId: "mot-d", amount: 300 }),
      tx({ categoryId: "mot-c", amount: 50 }),
      tx({ categoryId: "mot", amount: 25 }),
      tx({ categoryId: "comb", amount: 999, date: "2026-08-30" }), // mês passado
      tx({ categoryId: "comb", amount: 999, date: "2026-09-25" }), // futuro
      tx({ categoryId: "venda", amount: 999, type: "income" }), // receita
      tx({ categoryId: null, amount: 7 }),
    ];
    const r = spendByCategory(txs, categories, "2026-09-18");
    expect(r.month).toBe("2026-09");
    expect(r.total).toBe(482);
    expect(r.groups.map((g) => `${g.name}=${g.total}`)).toEqual([
      "Motoristas=375",
      "Combustível=100",
      "Sem categoria=7",
    ]);
    expect(r.groups[0].subs.map((s) => `${s.name}=${s.total}`)).toEqual(["Diárias=300", "Corridas=50"]);
    expect(r.idle).toEqual(["Aluguel"]);
  });
});

describe("buildExpensesMessages", () => {
  it("monta cabeçalho, blocos com percentual e rodapé das sem gasto", () => {
    const msgs = buildExpensesMessages(
      [tx({ categoryId: "comb", amount: 75 }), tx({ categoryId: "mot-d", amount: 25 })],
      categories,
      "2026-09-18",
    );
    expect(msgs).toHaveLength(1);
    const m = msgs[0].replace(/ /g, " ");
    expect(m).toContain("Gastos por categoria — setembro/2026</b> (até 18/09)");
    expect(m).toContain("Total gasto no mês: <b>R$ 100,00</b>");
    expect(m).toContain("🏷 <b>Combustível</b> — <b>R$ 75,00</b> (75%)");
    expect(m).toContain("🏷 <b>Motoristas</b> — <b>R$ 25,00</b> (25%)\n   ↳ Diárias — R$ 25,00");
    expect(m).toContain("<i>Sem gasto no mês:</i> Aluguel");
  });

  it("mês sem despesas", () => {
    const msgs = buildExpensesMessages([], categories, "2026-09-18");
    expect(msgs[0]).toContain("Nenhuma despesa lançada");
  });
});
