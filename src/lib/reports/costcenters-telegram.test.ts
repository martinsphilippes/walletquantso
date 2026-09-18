import { describe, it, expect } from "vitest";
import { buildCostCentersMessages, resultByCostCenter } from "./costcenters-telegram";
import type { Category, CostCenter, Transaction } from "@/types";

const cc = (id: string, name: string): CostCenter => ({ id, ownerId: "u", name, createdAt: 0 });
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

const centers = [cc("gialla", "Gialla"), cc("qp", "Qpaozinho"), cc("adm", "Administrativo")];
const categories = [
  cat("venda-g", "Entregas Gialla", { kind: "income", costCenterId: "gialla" }),
  cat("mot", "Motoristas", { costCenterId: "gialla" }),
  cat("mot-d", "Diárias", { parentId: "mot" }),
  cat("comb", "Combustível"),
];

describe("resultByCostCenter", () => {
  it("soma receitas e despesas do mês por centro, herdando o centro da categoria", () => {
    const txs = [
      tx({ type: "income", amount: 1000, categoryId: "venda-g" }), // centro pela categoria
      tx({ amount: 300, categoryId: "mot-d" }), // centro pela categoria-mãe
      tx({ amount: 50, categoryId: "comb", costCenterId: "qp" }), // centro no lançamento
      tx({ amount: 20, categoryId: "comb" }), // sem centro
      tx({ type: "income", amount: 999, categoryId: "venda-g", date: "2026-08-31" }), // mês passado
      tx({ type: "transfer", amount: 999, costCenterId: "gialla" }), // transferência não conta
    ];
    const r = resultByCostCenter(txs, categories, centers, "2026-09-18");
    expect(r.income).toBe(1000);
    expect(r.expense).toBe(370);
    expect(r.result).toBe(630);
    expect(r.rows.map((x) => `${x.name}:${x.income}/${x.expense}=${x.result}`)).toEqual([
      "Gialla:1000/300=700",
      "Qpaozinho:0/50=-50",
      "Administrativo:0/0=0",
      "Sem centro de custo:0/20=-20",
    ]);
  });
});

describe("buildCostCentersMessages", () => {
  it("monta cabeçalho com totais e um bloco por centro", () => {
    const msgs = buildCostCentersMessages(
      [tx({ type: "income", amount: 100, categoryId: "venda-g" }), tx({ amount: 40, categoryId: "mot-d" })],
      categories,
      centers,
      "2026-09-18",
    );
    expect(msgs).toHaveLength(1);
    const m = msgs[0].replace(/ /g, " ");
    expect(m).toContain("Resultado por centro de custo — setembro/2026</b> (até 18/09)");
    expect(m).toContain("Receitas <b>R$ 100,00</b> · Despesas <b>R$ 40,00</b>");
    expect(m).toContain("Resultado: 🟢 <b>R$ 60,00</b>");
    expect(m).toContain("🟢 <b>Gialla</b> — resultado <b>R$ 60,00</b>\n   ↑ receitas R$ 100,00\n   ↓ despesas R$ 40,00");
    expect(m).toContain("▫️ <b>Qpaozinho</b> — sem movimento");
  });
});
