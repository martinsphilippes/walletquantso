// WalletQuantso — dashboard filtering and totals (pure logic).
//
// Kept free of I/O so the filter/summary math is unit-testable. The page layer
// loads transactions from Firestore and feeds them through these helpers.

import type { Transaction, TransactionType } from "@/types";

export interface DashboardFilters {
  /** Free-text match against the description (accent/case-insensitive). */
  text?: string;
  /** Restrict to a single account (matches source or transfer destination). */
  accountId?: string;
  /** Restrict to a single transaction type. */
  type?: TransactionType | "";
  /** Inclusive ISO date lower bound (YYYY-MM-DD). */
  from?: string;
  /** Inclusive ISO date upper bound (YYYY-MM-DD). */
  to?: string;
}

function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Apply the active filters to a list of transactions. */
export function filterTransactions(
  txs: Transaction[],
  f: DashboardFilters,
): Transaction[] {
  const text = f.text ? fold(f.text) : "";
  return txs.filter((t) => {
    if (text && !fold(t.description ?? "").includes(text)) return false;
    if (f.accountId && t.accountId !== f.accountId && t.transferAccountId !== f.accountId)
      return false;
    if (f.type && t.type !== f.type) return false;
    if (f.from && t.date < f.from) return false;
    if (f.to && t.date > f.to) return false;
    return true;
  });
}

export interface Summary {
  income: number;
  expense: number;
  /** income − expense (transfers are net-zero and excluded). */
  balance: number;
  count: number;
}

/** Totals over a list of transactions. Transfers are excluded from in/out. */
export function summarize(txs: Transaction[]): Summary {
  let income = 0;
  let expense = 0;
  for (const t of txs) {
    if (t.type === "income") income += t.amount;
    else if (t.type === "expense") expense += t.amount;
  }
  return {
    income,
    expense,
    balance: income - expense,
    count: txs.length,
  };
}
