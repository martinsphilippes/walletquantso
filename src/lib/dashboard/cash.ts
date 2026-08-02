// WalletQuantso — cash balances per account and monthly result (pure logic).
//
// Powers the "Saldos de caixa" and "Resultado do mês" panels of the overview.
// Kept free of I/O so the money math is unit-testable.
//
//  • Confirmado (confirmed): money already in/out — account opening balance +
//    realized transaction movements + settlements recorded on bills.
//  • Projetado (projected):  confirmed + the still-open remainder of bills
//    (receivables add, payables subtract).
//
// A movement or bill with no account is bucketed under `accountId: null`
// ("Sem conta") so nothing is ever silently dropped.

import type { Account, Bill, Transaction } from "@/types";
import { paidAmount, remaining } from "@/lib/bills/status";

const round = (n: number) => Math.round(n * 100) / 100;
const monthOf = (iso: string) => iso.slice(0, 7);

export interface AccountCash {
  /** Account id, or null for amounts not tied to any account. */
  accountId: string | null;
  name: string;
  confirmed: number;
  projected: number;
}

export interface CashBalances {
  rows: AccountCash[];
  totalConfirmed: number;
  totalProjected: number;
}

/** Per-account confirmed and projected cash balances. */
export function computeCashBalances(
  accounts: Account[],
  txs: Transaction[],
  payables: Bill[],
  receivables: Bill[],
): CashBalances {
  const order: (string | null)[] = [];
  const rows = new Map<string | null, AccountCash>();
  const ensure = (accountId: string | null, name: string): AccountCash => {
    let r = rows.get(accountId);
    if (!r) {
      r = { accountId, name, confirmed: 0, projected: 0 };
      rows.set(accountId, r);
      order.push(accountId);
    }
    return r;
  };

  for (const a of accounts) {
    if (!a.id) continue;
    const r = ensure(a.id, a.name);
    // The opening balance is part of both the confirmed and the projected base.
    r.confirmed += a.initialBalance ?? 0;
    r.projected += a.initialBalance ?? 0;
  }

  const nameFor = new Map(accounts.map((a) => [a.id, a.name] as const));
  const label = (id: string | null | undefined) =>
    id ? (nameFor.get(id) ?? "Conta") : "Sem conta";

  // Both confirmed and projected start from the opening balance already applied.
  const applyBoth = (id: string | null | undefined, delta: number) => {
    const key = id ?? null;
    const r = ensure(key, label(key));
    r.confirmed += delta;
    r.projected += delta;
  };
  const applyProjected = (id: string | null | undefined, delta: number) => {
    const key = id ?? null;
    const r = ensure(key, label(key));
    r.projected += delta;
  };

  for (const t of txs) {
    if (t.type === "income") applyBoth(t.accountId, t.amount);
    else if (t.type === "expense") applyBoth(t.accountId, -t.amount);
    else if (t.type === "transfer") {
      applyBoth(t.accountId, -t.amount);
      applyBoth(t.transferAccountId, t.amount);
    }
  }

  // Bill settlements are confirmed cash; open remainders are projected only.
  for (const b of receivables) {
    for (const p of b.payments) applyBoth(p.accountId ?? b.accountId, p.amount || 0);
    const rem = remaining(b);
    if (rem > 0) applyProjected(b.accountId, rem);
  }
  for (const b of payables) {
    for (const p of b.payments) applyBoth(p.accountId ?? b.accountId, -(p.amount || 0));
    const rem = remaining(b);
    if (rem > 0) applyProjected(b.accountId, -rem);
  }

  let totalConfirmed = 0;
  let totalProjected = 0;
  const list = order.map((k) => {
    const r = rows.get(k)!;
    r.confirmed = round(r.confirmed);
    r.projected = round(r.projected);
    totalConfirmed += r.confirmed;
    totalProjected += r.projected;
    return r;
  });

  return {
    rows: list,
    totalConfirmed: round(totalConfirmed),
    totalProjected: round(totalProjected),
  };
}

export interface MonthResult {
  /** Bucket month as YYYY-MM. */
  month: string;
  /** Projected income for the month: received in-month + still-open due in-month. */
  income: number;
  /** Projected expense for the month: paid in-month + still-open due in-month. */
  expense: number;
  /** income − expense. */
  result: number;
}

/**
 * Projected result for a given month (defaults to the current month): what is
 * expected to move in/out, combining realized movements dated in the month with
 * the still-open remainder of bills due in the month.
 */
export function monthResult(
  txs: Transaction[],
  payables: Bill[],
  receivables: Bill[],
  month: string = new Date().toISOString().slice(0, 7),
): MonthResult {
  let income = 0;
  let expense = 0;

  for (const t of txs) {
    if (monthOf(t.date) !== month) continue;
    if (t.type === "income") income += t.amount;
    else if (t.type === "expense") expense += t.amount;
  }

  for (const b of receivables) {
    for (const p of b.payments) if (monthOf(p.date) === month) income += p.amount || 0;
    if (monthOf(b.dueDate) === month) income += remaining(b);
  }
  for (const b of payables) {
    for (const p of b.payments) if (monthOf(p.date) === month) expense += p.amount || 0;
    if (monthOf(b.dueDate) === month) expense += remaining(b);
  }

  income = round(income);
  expense = round(expense);
  return { month, income, expense, result: round(income - expense) };
}

/** Sum of settlements across a bill list (helper for panels/tests). */
export function totalSettled(bills: Bill[]): number {
  return round(bills.reduce((s, b) => s + paidAmount(b), 0));
}
