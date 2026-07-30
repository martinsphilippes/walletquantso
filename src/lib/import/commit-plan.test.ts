import { describe, it, expect } from "vitest";
import { planCommit } from "./commit-plan";
import { buildPreview, type RawRow } from "./engine";
import type { ColumnMapping } from "@/types";

const MAPPING: ColumnMapping = {
  Data: "date",
  Descrição: "description",
  Valor: "amount",
  Conta: "account",
  Categoria: "category",
};

function importableFrom(rows: RawRow[]) {
  return buildPreview(rows, MAPPING).importable;
}

describe("planCommit", () => {
  it("creates new rows and flags new accounts/categories", () => {
    const importable = importableFrom([
      { Data: "01/01/2025", Descrição: "Mercado", Valor: "-50,00", Conta: "Nubank", Categoria: "Alimentação" },
      { Data: "02/01/2025", Descrição: "Salário", Valor: "1000,00", Conta: "Itaú", Categoria: "Renda" },
    ]);
    const plan = planCommit(importable, new Set(), new Set(), new Set());
    expect(plan.toCreate.length).toBe(2);
    expect(plan.newAccountNames.sort()).toEqual(["Itaú", "Nubank"]);
    expect(plan.newCategoryNames.sort()).toEqual(["Alimentação", "Renda"]);
  });

  it("skips rows already present in the DB by hash", () => {
    const importable = importableFrom([
      { Data: "01/01/2025", Descrição: "Mercado", Valor: "-50,00", Conta: "Nubank", Categoria: "Alimentação" },
    ]);
    const existingHash = importable[0].transaction!.dedupHash;
    const plan = planCommit(importable, new Set([existingHash]), new Set(["nubank"]), new Set());
    expect(plan.toCreate.length).toBe(0);
    expect(plan.skippedExistingDb.length).toBe(1);
  });

  it("skips in-file duplicates, keeping the first", () => {
    const importable = importableFrom([
      { Data: "01/01/2025", Descrição: "Café", Valor: "-5,00", Conta: "Nubank" },
      { Data: "01/01/2025", Descrição: "Café", Valor: "-5,00", Conta: "Nubank" },
    ]);
    const plan = planCommit(importable, new Set(), new Set(["nubank"]), new Set());
    expect(plan.toCreate.length).toBe(1);
    expect(plan.skippedInFile.length).toBe(1);
  });

  it("does not re-create existing accounts (case/accent-insensitive)", () => {
    const importable = importableFrom([
      { Data: "01/01/2025", Descrição: "x", Valor: "-5,00", Conta: "NUBANK" },
    ]);
    const plan = planCommit(importable, new Set(), new Set(["nubank"]), new Set());
    expect(plan.newAccountNames).toEqual([]);
  });
});
