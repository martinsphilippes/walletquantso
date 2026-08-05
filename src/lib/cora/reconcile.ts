// WalletQuantso — Cora × Wallet reconciliation (pure logic).
//
// Compares the Cora statement of a period with the Wallet's lançamentos for the
// same account and period, and classifies the differences:
//
//   • duplicates  — Wallet entries in excess of what the bank shows for the same
//     (date, amount, direction). Typical cause: the same real movement recorded
//     twice — once from an older import/baixa and once from the Cora sync.
//     Entries imported from Cora (externalId) are treated as canonical; the
//     surplus non-Cora ones are flagged.
//   • walletOnly  — Wallet movements the bank statement does not show at all.
//   • coraOnly    — bank movements missing from the Wallet (not imported yet).
//
// Matching is count-based per key (date|amount|direction), so N legitimate
// identical movements on the same day are NOT flagged unless the Wallet has
// more of them than the bank does.

import type { Transaction } from "@/types";
import type { NormalizedEntry } from "./statement";

const round = (n: number) => Math.round(n * 100) / 100;

/** Signed effect of a lançamento on the given account (0 = does not touch it). */
export function signedForAccount(t: Transaction, accountId: string): number {
  if (t.type === "income") return t.accountId === accountId ? t.amount : 0;
  if (t.type === "expense") return t.accountId === accountId ? -t.amount : 0;
  // transfer: source loses, destination gains
  if (t.accountId === accountId) return -t.amount;
  if (t.transferAccountId === accountId) return t.amount;
  return 0;
}

export interface CoraComparison {
  /** Wallet entries flagged as likely duplicates (safe to delete). */
  duplicates: Transaction[];
  /** Wallet entries with no bank counterpart in the period. */
  walletOnly: Transaction[];
  /** Bank movements with no Wallet counterpart (not imported). */
  coraOnly: NormalizedEntry[];
  /** Net movement of the period according to the Wallet (this account). */
  walletNet: number;
  /** Net movement of the period according to the bank. */
  coraNet: number;
}

export function compareWithCora(
  entries: NormalizedEntry[],
  txs: Transaction[],
  accountId: string,
  start: string,
  end: string,
): CoraComparison {
  const inPeriod = (d: string) => d >= start && d <= end;

  // Wallet movements touching this account within the period.
  const wallet = txs
    .map((t) => ({ t, signed: signedForAccount(t, accountId) }))
    .filter((x) => x.signed !== 0 && inPeriod(x.t.date));

  const keyOf = (date: string, amount: number, dir: 1 | -1) =>
    `${date}|${round(amount)}|${dir > 0 ? "C" : "D"}`;

  // Bank movement count per key.
  const bankCount = new Map<string, number>();
  for (const e of entries) {
    const k = keyOf(e.date, e.amount, e.type === "income" ? 1 : -1);
    bankCount.set(k, (bankCount.get(k) ?? 0) + 1);
  }

  // Group wallet entries per key, Cora-imported first (they are canonical).
  const walletByKey = new Map<string, Transaction[]>();
  for (const { t, signed } of wallet) {
    const k = keyOf(t.date, Math.abs(signed), signed > 0 ? 1 : -1);
    const list = walletByKey.get(k) ?? [];
    if (t.externalId) list.unshift(t);
    else list.push(t);
    walletByKey.set(k, list);
  }

  const duplicates: Transaction[] = [];
  const walletOnly: Transaction[] = [];
  for (const [k, list] of walletByKey) {
    const allowed = bankCount.get(k) ?? 0;
    if (allowed === 0) {
      walletOnly.push(...list);
    } else if (list.length > allowed) {
      // Keep the first `allowed` (Cora-imported sorted first); flag the rest.
      duplicates.push(...list.slice(allowed));
    }
  }

  // Bank movements not covered by the Wallet.
  const coraOnly: NormalizedEntry[] = [];
  const used = new Map<string, number>();
  for (const e of entries) {
    const k = keyOf(e.date, e.amount, e.type === "income" ? 1 : -1);
    const have = walletByKey.get(k)?.length ?? 0;
    const consumed = (used.get(k) ?? 0) + 1;
    used.set(k, consumed);
    if (consumed > have) coraOnly.push(e);
  }

  const walletNet = round(wallet.reduce((s, x) => s + x.signed, 0));
  const coraNet = round(
    entries.reduce((s, e) => s + (e.type === "income" ? e.amount : -e.amount), 0),
  );

  // Sort for stable display (newest first).
  const byDateDesc = (a: { date: string }, b: { date: string }) => (a.date < b.date ? 1 : -1);
  duplicates.sort(byDateDesc);
  walletOnly.sort(byDateDesc);
  coraOnly.sort(byDateDesc);

  return { duplicates, walletOnly, coraOnly, walletNet, coraNet };
}
