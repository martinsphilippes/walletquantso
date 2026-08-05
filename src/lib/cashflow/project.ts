// WalletQuantso — cash-flow projection (pure logic).
//
// Builds a month-by-month timeline that combines what already happened
// (realized transactions) with what is still expected (the outstanding balance
// of open bills), then rolls a running projected balance forward from an
// opening balance. Transfers move money between the user's own accounts, so
// they net to zero for total cash and are ignored here.

import type { Bill, Transaction } from "@/types";
import { remaining } from "@/lib/bills/status";
import { todayBr } from "@/lib/br/date";

export interface CashFlowMonth {
  /** Bucket month as YYYY-MM. */
  month: string;
  realizedIn: number;
  realizedOut: number;
  /** Outstanding receivables due in this month. */
  plannedIn: number;
  /** Outstanding payables due in this month. */
  plannedOut: number;
  /** (realizedIn − realizedOut) + (plannedIn − plannedOut). */
  net: number;
  /** Running balance from the opening balance through this month. */
  balance: number;
}

export interface CashFlowOptions {
  /** Balance before the first month (e.g. sum of account initial balances). */
  openingBalance?: number;
  /** Reference "today" as YYYY-MM-DD; defaults to the current day. */
  today?: string;
  /** Always include at least this many future months. Default 6. */
  monthsAhead?: number;
  /**
   * "projected" (default): realized + open bills due per month.
   * "realized": only money that actually moved — bills are ignored and no
   * future months are appended (the balance is the real cash trajectory).
   */
  mode?: "projected" | "realized";
}

const monthOf = (iso: string) => iso.slice(0, 7);

/** Add `n` months to a YYYY-MM string. */
function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Project cash flow by month. Overdue open bills are surfaced in the current
 * month (they still need to be settled), not left stranded in a past month.
 */
export function projectCashFlow(
  txs: Transaction[],
  bills: Bill[],
  opts: CashFlowOptions = {},
): CashFlowMonth[] {
  const openingBalance = opts.openingBalance ?? 0;
  const today = opts.today ?? todayBr();
  const currentMonth = monthOf(today);
  const mode = opts.mode ?? "projected";
  const monthsAhead = mode === "realized" ? 0 : (opts.monthsAhead ?? 6);

  const rows = new Map<string, CashFlowMonth>();
  const ensure = (month: string): CashFlowMonth => {
    let r = rows.get(month);
    if (!r) {
      r = { month, realizedIn: 0, realizedOut: 0, plannedIn: 0, plannedOut: 0, net: 0, balance: 0 };
      rows.set(month, r);
    }
    return r;
  };

  for (const t of txs) {
    if (t.type === "transfer") continue;
    const r = ensure(monthOf(t.date));
    if (t.type === "income") r.realizedIn = round(r.realizedIn + t.amount);
    else r.realizedOut = round(r.realizedOut + t.amount);
  }

  for (const b of bills) {
    if (mode === "realized") break; // realized view: bills don't enter the flow
    const rem = remaining(b);
    if (rem <= 0) continue;
    // Overdue obligations belong to "now", not to a past month.
    const due = monthOf(b.dueDate);
    const month = due < currentMonth ? currentMonth : due;
    const r = ensure(month);
    if (b.kind === "receivable") r.plannedIn = round(r.plannedIn + rem);
    else r.plannedOut = round(r.plannedOut + rem);
  }

  // Guarantee the window includes the current month and `monthsAhead` after it.
  ensure(currentMonth);
  for (let i = 1; i <= monthsAhead; i++) ensure(addMonths(currentMonth, i));

  const months = [...rows.keys()].sort();
  let balance = openingBalance;
  const result: CashFlowMonth[] = [];
  for (const m of months) {
    const r = rows.get(m)!;
    r.net = round(r.realizedIn - r.realizedOut + r.plannedIn - r.plannedOut);
    balance = round(balance + r.net);
    r.balance = balance;
    result.push(r);
  }
  return result;
}
