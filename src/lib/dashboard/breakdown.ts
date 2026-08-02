// WalletQuantso — projected breakdowns by category and cost center (pure logic).
//
// "Situação projetada" = realized movements (transactions) + planned ones
// (bills at their full amount). Receitas come from income transactions and
// receivables; despesas from expense transactions and payables. Grouped by
// category or cost center for the overview charts. Kept free of I/O so it is
// unit-testable. Transfers are internal and never counted.

import type { Bill, Category, CostCenter, Transaction } from "@/types";

const round = (n: number) => Math.round(n * 100) / 100;

export interface Slice {
  /** Grouping id, or null when the record has no category/center. */
  id: string | null;
  label: string;
  value: number;
}

function nameMap(items: Array<{ id?: string; name: string }>): Map<string, string> {
  return new Map(items.filter((i) => i.id).map((i) => [i.id as string, i.name]));
}

/** Group signed amounts by key, resolve labels, drop zeros, sort desc. */
function group(
  entries: Array<{ key: string | null; value: number }>,
  names: Map<string, string>,
  fallback: string,
): Slice[] {
  const sums = new Map<string | null, number>();
  for (const e of entries) sums.set(e.key, (sums.get(e.key) ?? 0) + e.value);
  const slices: Slice[] = [];
  for (const [id, value] of sums) {
    const rounded = round(value);
    if (rounded === 0) continue;
    slices.push({
      id,
      label: id ? (names.get(id) ?? fallback) : fallback,
      value: rounded,
    });
  }
  return slices.sort((a, b) => b.value - a.value);
}

/** Projected receitas grouped by category. */
export function receitasPorCategoria(
  txs: Transaction[],
  receivables: Bill[],
  categories: Category[],
): Slice[] {
  const names = nameMap(categories);
  const entries: Array<{ key: string | null; value: number }> = [];
  for (const t of txs) if (t.type === "income") entries.push({ key: t.categoryId ?? null, value: t.amount });
  for (const b of receivables) entries.push({ key: b.categoryId ?? null, value: b.amount });
  return group(entries, names, "Sem categoria");
}

/** Projected despesas grouped by category. */
export function despesasPorCategoria(
  txs: Transaction[],
  payables: Bill[],
  categories: Category[],
): Slice[] {
  const names = nameMap(categories);
  const entries: Array<{ key: string | null; value: number }> = [];
  for (const t of txs) if (t.type === "expense") entries.push({ key: t.categoryId ?? null, value: t.amount });
  for (const b of payables) entries.push({ key: b.categoryId ?? null, value: b.amount });
  return group(entries, names, "Sem categoria");
}

/** Projected receitas grouped by cost center. */
export function receitasPorCentro(
  txs: Transaction[],
  receivables: Bill[],
  costCenters: CostCenter[],
): Slice[] {
  const names = nameMap(costCenters);
  const entries: Array<{ key: string | null; value: number }> = [];
  for (const t of txs) if (t.type === "income") entries.push({ key: t.costCenterId ?? null, value: t.amount });
  for (const b of receivables) entries.push({ key: b.costCenterId ?? null, value: b.amount });
  return group(entries, names, "Sem centro");
}

/** Projected despesas grouped by cost center. */
export function despesasPorCentro(
  txs: Transaction[],
  payables: Bill[],
  costCenters: CostCenter[],
): Slice[] {
  const names = nameMap(costCenters);
  const entries: Array<{ key: string | null; value: number }> = [];
  for (const t of txs) if (t.type === "expense") entries.push({ key: t.costCenterId ?? null, value: t.amount });
  for (const b of payables) entries.push({ key: b.costCenterId ?? null, value: b.amount });
  return group(entries, names, "Sem centro");
}

export interface CentroResult {
  id: string | null;
  name: string;
  receitas: number;
  despesas: number;
  resultado: number;
}

/** Projected receitas, despesas and resultado grouped by cost center. */
export function resultadosPorCentro(
  txs: Transaction[],
  payables: Bill[],
  receivables: Bill[],
  costCenters: CostCenter[],
): CentroResult[] {
  const names = nameMap(costCenters);
  const rows = new Map<string | null, { receitas: number; despesas: number }>();
  const ensure = (key: string | null) => {
    let r = rows.get(key);
    if (!r) {
      r = { receitas: 0, despesas: 0 };
      rows.set(key, r);
    }
    return r;
  };

  for (const t of txs) {
    if (t.type === "income") ensure(t.costCenterId ?? null).receitas += t.amount;
    else if (t.type === "expense") ensure(t.costCenterId ?? null).despesas += t.amount;
  }
  for (const b of receivables) ensure(b.costCenterId ?? null).receitas += b.amount;
  for (const b of payables) ensure(b.costCenterId ?? null).despesas += b.amount;

  const result: CentroResult[] = [];
  for (const [id, v] of rows) {
    const receitas = round(v.receitas);
    const despesas = round(v.despesas);
    if (receitas === 0 && despesas === 0) continue;
    result.push({
      id,
      name: id ? (names.get(id) ?? "Sem centro") : "Sem centro",
      receitas,
      despesas,
      resultado: round(receitas - despesas),
    });
  }
  // Highest result first (most positive on top), like the reference table.
  return result.sort((a, b) => b.resultado - a.resultado);
}
