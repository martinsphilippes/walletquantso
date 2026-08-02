// WalletQuantso — bank reconciliation / clearing (pure logic).
//
// Classic statement reconciliation for a single account: entries flagged as
// `reconciled` are the ones that have cleared the bank. The cleared balance is
// the initial balance plus only the cleared movements; the difference against
// the full current balance is everything still pending.

import type { Account, Transaction } from "@/types";

/** Signed effect of a transaction on a specific account (0 if unrelated). */
export function movementFor(t: Transaction, accountId: string): number {
  if (t.type === "income" && t.accountId === accountId) return t.amount;
  if (t.type === "expense" && t.accountId === accountId) return -t.amount;
  if (t.type === "transfer") {
    if (t.accountId === accountId) return -t.amount;
    if (t.transferAccountId === accountId) return t.amount;
  }
  return 0;
}

/** Transactions that touch the given account, in the order provided. */
export function transactionsForAccount(txs: Transaction[], accountId: string): Transaction[] {
  return txs.filter((t) => movementFor(t, accountId) !== 0);
}

export interface ClearingSummary {
  /** initial balance + cleared movements. */
  clearedBalance: number;
  /** initial balance + all movements. */
  currentBalance: number;
  /** Net of movements not yet cleared (currentBalance − clearedBalance). */
  pendingAmount: number;
  /** Count of entries touching the account that are not yet cleared. */
  pendingCount: number;
  /** Count of cleared entries touching the account. */
  clearedCount: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Reconciliation summary for one account against its transactions. */
export function summarizeClearing(account: Account, txs: Transaction[]): ClearingSummary {
  const initial = account.initialBalance ?? 0;
  let cleared = 0;
  let all = 0;
  let pendingCount = 0;
  let clearedCount = 0;
  for (const t of txs) {
    const m = movementFor(t, account.id!);
    if (m === 0) continue;
    all = round(all + m);
    if (t.reconciled) {
      cleared = round(cleared + m);
      clearedCount++;
    } else {
      pendingCount++;
    }
  }
  const clearedBalance = round(initial + cleared);
  const currentBalance = round(initial + all);
  return {
    clearedBalance,
    currentBalance,
    pendingAmount: round(currentBalance - clearedBalance),
    pendingCount,
    clearedCount,
  };
}
