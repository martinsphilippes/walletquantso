// WalletQuantso — report aggregations (pure).
//
// Grouping/summing logic kept free of I/O so the numbers are unit-testable.
// The page layer resolves category ids to names and renders the bars.

import type { Transaction, TransactionType } from "@/types";

export interface CategoryTotal {
  /** null means "no category". */
  categoryId: string | null;
  total: number;
}

/**
 * Sum the amounts of transactions of a given type, grouped by category,
 * sorted from largest to smallest. Uncategorized entries are grouped under a
 * null id.
 */
export function totalsByCategory(
  txs: Transaction[],
  type: TransactionType,
): CategoryTotal[] {
  const sums = new Map<string | null, number>();
  for (const t of txs) {
    if (t.type !== type) continue;
    const key = t.categoryId ?? null;
    sums.set(key, (sums.get(key) ?? 0) + t.amount);
  }
  return [...sums.entries()]
    .map(([categoryId, total]) => ({ categoryId, total }))
    .sort((a, b) => b.total - a.total);
}

export interface MonthTotal {
  /** "YYYY-MM". */
  month: string;
  income: number;
  expense: number;
  balance: number;
}

/** Group transactions by calendar month, summing income and expense. */
export function totalsByMonth(txs: Transaction[]): MonthTotal[] {
  const byMonth = new Map<string, MonthTotal>();
  for (const t of txs) {
    const month = t.date.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    let row = byMonth.get(month);
    if (!row) {
      row = { month, income: 0, expense: 0, balance: 0 };
      byMonth.set(month, row);
    }
    if (t.type === "income") row.income += t.amount;
    else if (t.type === "expense") row.expense += t.amount;
  }
  return [...byMonth.values()]
    .map((r) => ({ ...r, balance: r.income - r.expense }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/** Distinct "YYYY-MM" months present in the data, newest first. */
export function monthsPresent(txs: Transaction[]): string[] {
  const set = new Set<string>();
  for (const t of txs) {
    const m = t.date.slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(m)) set.add(m);
  }
  return [...set].sort((a, b) => b.localeCompare(a));
}
