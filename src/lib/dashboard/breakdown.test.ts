import { describe, it, expect } from "vitest";
import {
  receitasPorCategoria,
  despesasPorCategoria,
  receitasPorCentro,
  despesasPorCentro,
  resultadosPorCentro,
} from "./breakdown";
import type { Bill, Category, CostCenter, Transaction } from "@/types";

function cat(id: string, name: string, kind: Category["kind"] = "expense"): Category {
  return { id, ownerId: "u1", name, kind, parentId: null, createdAt: 0 };
}
function center(id: string, name: string): CostCenter {
  return { id, ownerId: "u1", name, createdAt: 0 };
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
function bill(kind: Bill["kind"], amount: number, extra: Partial<Bill> = {}): Bill {
  return {
    ownerId: "u1",
    kind,
    description: "b",
    amount,
    dueDate: "2026-08-10",
    payments: [],
    createdAt: 0,
    ...extra,
  };
}

describe("despesasPorCategoria", () => {
  it("combines expense transactions and payables at full amount, sorted desc", () => {
    const categories = [cat("c1", "Aluguel"), cat("c2", "Mercado")];
    const slices = despesasPorCategoria(
      [tx("expense", 100, { categoryId: "c1" }), tx("expense", 50, { categoryId: "c2" })],
      [bill("payable", 400, { categoryId: "c1" })],
      categories,
    );
    expect(slices[0]).toMatchObject({ label: "Aluguel", value: 500 });
    expect(slices[1]).toMatchObject({ label: "Mercado", value: 50 });
  });

  it("buckets missing categories under 'Sem categoria' and ignores income", () => {
    const slices = despesasPorCategoria(
      [tx("expense", 30), tx("income", 999, { categoryId: "c1" })],
      [],
      [],
    );
    expect(slices).toEqual([{ id: null, label: "Sem categoria", value: 30 }]);
  });
});

describe("receitasPorCategoria", () => {
  it("combines income transactions and receivables", () => {
    const categories = [cat("c1", "Vendas", "income")];
    const slices = receitasPorCategoria(
      [tx("income", 200, { categoryId: "c1" })],
      [bill("receivable", 800, { categoryId: "c1" })],
      categories,
    );
    expect(slices).toEqual([{ id: "c1", label: "Vendas", value: 1000 }]);
  });
});

describe("por centro (pizzas)", () => {
  const centers = [center("k1", "Familia"), center("k2", "Loja")];

  it("groups projected despesas by cost center", () => {
    const slices = despesasPorCentro(
      [tx("expense", 100, { costCenterId: "k1" })],
      [bill("payable", 400, { costCenterId: "k2" }), bill("payable", 50, { costCenterId: "k1" })],
      centers,
    );
    expect(slices[0]).toMatchObject({ label: "Loja", value: 400 });
    expect(slices[1]).toMatchObject({ label: "Familia", value: 150 });
  });

  it("groups projected receitas by cost center and ignores expenses", () => {
    const slices = receitasPorCentro(
      [tx("income", 200, { costCenterId: "k1" }), tx("expense", 999, { costCenterId: "k1" })],
      [bill("receivable", 300, { costCenterId: "k1" })],
      centers,
    );
    expect(slices).toEqual([{ id: "k1", label: "Familia", value: 500 }]);
  });
});

describe("modo realizado", () => {
  it("conta só o que movimentou: lançamentos + baixas não materializadas, sem o em aberto", () => {
    const centers = [center("k1", "Familia")];
    const partial = bill("receivable", 300, {
      costCenterId: "k1",
      payments: [
        { id: "p1", date: "2026-08-01", amount: 100 }, // baixa antiga, sem lançamento
        { id: "p2", date: "2026-08-02", amount: 50, transactionId: "tx-x" }, // já é lançamento
      ],
    });
    const slices = receitasPorCentro(
      [tx("income", 200, { costCenterId: "k1" })],
      [partial],
      centers,
      "realized",
    );
    // 200 (lançamento) + 100 (baixa não materializada); os 150 em aberto ficam fora
    // e os 50 materializados viriam por um lançamento próprio (não duplicam aqui).
    expect(slices).toEqual([{ id: "k1", label: "Familia", value: 300 }]);
  });
});

describe("resultadosPorCentro", () => {
  it("computes receitas, despesas and resultado per cost center", () => {
    const centers = [center("k1", "Familia"), center("k2", "Loja")];
    const rows = resultadosPorCentro(
      [tx("income", 1000, { costCenterId: "k1" }), tx("expense", 300, { costCenterId: "k1" })],
      [bill("payable", 200, { costCenterId: "k2" })],
      [bill("receivable", 50, { costCenterId: "k2" })],
      centers,
    );
    const k1 = rows.find((r) => r.id === "k1")!;
    const k2 = rows.find((r) => r.id === "k2")!;
    expect(k1).toMatchObject({ name: "Familia", receitas: 1000, despesas: 300, resultado: 700 });
    expect(k2).toMatchObject({ name: "Loja", receitas: 50, despesas: 200, resultado: -150 });
    // sorted by resultado desc
    expect(rows[0].id).toBe("k1");
  });
});
