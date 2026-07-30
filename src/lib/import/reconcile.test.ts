import { describe, it, expect } from "vitest";
import {
  reconcileTransfers,
  reconcileInstallments,
  stripInstallmentSuffix,
  reconcile,
} from "./reconcile";
import { buildPreview, type RawRow } from "./engine";
import type { ColumnMapping } from "@/types";

const MAP: ColumnMapping = {
  Data: "date",
  Descrição: "description",
  Valor: "amount",
  Conta: "account",
  Parcela: "installment",
};

const importable = (rows: RawRow[]) => buildPreview(rows, MAP).importable;

describe("reconcileTransfers", () => {
  it("merges an outflow + inflow of same value in different accounts", () => {
    const rows = importable([
      { Data: "01/01/2025", Descrição: "TED enviada", Valor: "-500,00", Conta: "Itaú" },
      { Data: "01/01/2025", Descrição: "TED recebida", Valor: "500,00", Conta: "Nubank" },
    ]);
    const r = reconcileTransfers(rows);
    expect(r.transfersFound).toBe(1);
    expect(r.rows.length).toBe(1);
    const t = r.rows[0].transaction!;
    expect(t.type).toBe("transfer");
    expect(t.accountId).toBe("Itaú"); // source (outflow)
    expect(t.transferAccountId).toBe("Nubank"); // destination (inflow)
    expect(t.amount).toBe(500);
  });

  it("does not merge same-account pairs", () => {
    const rows = importable([
      { Data: "01/01/2025", Descrição: "a", Valor: "-500,00", Conta: "Itaú" },
      { Data: "01/01/2025", Descrição: "b", Valor: "500,00", Conta: "Itaú" },
    ]);
    expect(reconcileTransfers(rows).transfersFound).toBe(0);
  });

  it("respects the day gap window", () => {
    const rows = importable([
      { Data: "01/01/2025", Descrição: "a", Valor: "-500,00", Conta: "Itaú" },
      { Data: "20/01/2025", Descrição: "b", Valor: "500,00", Conta: "Nubank" },
    ]);
    expect(reconcileTransfers(rows, { maxDayGap: 3 }).transfersFound).toBe(0);
    expect(reconcileTransfers(rows, { maxDayGap: 30 }).transfersFound).toBe(1);
  });

  it("leaves unrelated rows untouched", () => {
    const rows = importable([
      { Data: "01/01/2025", Descrição: "Mercado", Valor: "-50,00", Conta: "Itaú" },
      { Data: "02/01/2025", Descrição: "Salário", Valor: "1000,00", Conta: "Itaú" },
    ]);
    const r = reconcileTransfers(rows);
    expect(r.transfersFound).toBe(0);
    expect(r.rows.length).toBe(2);
  });
});

describe("stripInstallmentSuffix", () => {
  it("removes trailing installment markers", () => {
    expect(stripInstallmentSuffix("Notebook 3/12")).toBe("Notebook");
    expect(stripInstallmentSuffix("Notebook (3/12)")).toBe("Notebook");
    expect(stripInstallmentSuffix("Notebook parcela 3/12")).toBe("Notebook");
  });
});

describe("reconcileInstallments", () => {
  it("groups installments of the same purchase", () => {
    const rows = importable([
      { Data: "01/01/2025", Descrição: "Notebook 1/3", Valor: "-100,00", Conta: "Cartão", Parcela: "1/3" },
      { Data: "01/02/2025", Descrição: "Notebook 2/3", Valor: "-100,00", Conta: "Cartão", Parcela: "2/3" },
      { Data: "01/03/2025", Descrição: "Notebook 3/3", Valor: "-100,00", Conta: "Cartão", Parcela: "3/3" },
    ]);
    const r = reconcileInstallments(rows);
    expect(r.installmentGroupsFound).toBe(1);
    const ids = r.rows.map((x) => x.transaction!.installmentGroupId);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBeTruthy();
  });

  it("keeps distinct purchases in separate groups", () => {
    const rows = importable([
      { Data: "01/01/2025", Descrição: "TV 1/2", Valor: "-100,00", Conta: "Cartão", Parcela: "1/2" },
      { Data: "01/02/2025", Descrição: "Geladeira 1/2", Valor: "-100,00", Conta: "Cartão", Parcela: "1/2" },
    ]);
    expect(reconcileInstallments(rows).installmentGroupsFound).toBe(2);
  });
});

describe("reconcile", () => {
  it("runs transfers then installments together", () => {
    const rows = importable([
      { Data: "01/01/2025", Descrição: "TED", Valor: "-500,00", Conta: "Itaú" },
      { Data: "01/01/2025", Descrição: "TED", Valor: "500,00", Conta: "Nubank" },
      { Data: "01/01/2025", Descrição: "Fone 1/2", Valor: "-40,00", Conta: "Cartão", Parcela: "1/2" },
      { Data: "01/02/2025", Descrição: "Fone 2/2", Valor: "-40,00", Conta: "Cartão", Parcela: "2/2" },
    ]);
    const r = reconcile(rows);
    expect(r.transfersFound).toBe(1);
    expect(r.installmentGroupsFound).toBe(1);
    // 4 rows -> 1 transfer + 2 installments = 3 rows
    expect(r.rows.length).toBe(3);
  });
});
