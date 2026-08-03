// WalletQuantso — bill (payable/receivable) status math (pure logic).
//
// Kept free of I/O so status, remaining amounts and totals are unit-testable.
// A bill's status is derived from its payments and due date, never stored, so
// it can never drift out of sync with the payments.

import type { Bill } from "@/types";

export type BillStatus = "paid" | "partial" | "overdue" | "open";

/** Total settled so far (sum of payment amounts). */
export function paidAmount(bill: Pick<Bill, "payments">): number {
  return bill.payments.reduce((sum, p) => sum + (p.amount || 0), 0);
}

/**
 * Settled amount NOT yet materialized as a ledger transaction. When a baixa is
 * materialized (it has a `transactionId`), the cash is represented by that
 * transaction, so dashboard math must not also count the payment. Older baixas
 * without a `transactionId` are still counted here so nothing is lost.
 */
export function unmaterializedPaid(bill: Pick<Bill, "payments">): number {
  return bill.payments.reduce(
    (sum, p) => sum + (p.transactionId ? 0 : p.amount || 0),
    0,
  );
}

/** Amount still outstanding (never negative). */
export function remaining(bill: Pick<Bill, "amount" | "payments">): number {
  return Math.max(0, round(bill.amount - paidAmount(bill)));
}

/** Round to cents to avoid floating-point noise. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Derive a bill's status.
 *  • paid     — fully settled (paid >= amount)
 *  • partial  — some paid, but not all
 *  • overdue  — nothing/partly paid and the due date is in the past
 *  • open     — nothing paid and not yet due
 * `today` is an ISO date (YYYY-MM-DD); defaults to the current day.
 */
export function billStatus(
  bill: Pick<Bill, "amount" | "dueDate" | "payments">,
  today: string = new Date().toISOString().slice(0, 10),
): BillStatus {
  const paid = paidAmount(bill);
  if (paid + 0.005 >= bill.amount && bill.amount > 0) return "paid";
  if (bill.dueDate < today) return "overdue";
  if (paid > 0) return "partial";
  return "open";
}

export const STATUS_LABELS: Record<BillStatus, string> = {
  paid: "Pago",
  partial: "Parcial",
  overdue: "Vencido",
  open: "Em aberto",
};

export interface BillsSummary {
  count: number;
  /** Sum of every bill's total amount. */
  total: number;
  /** Sum of outstanding amounts across not-fully-paid bills. */
  outstanding: number;
  /** Outstanding amount whose due date is in the past. */
  overdue: number;
  /** Outstanding amount not yet due. */
  upcoming: number;
  paidCount: number;
}

/** Totals across a list of bills, split by realized vs pending / overdue. */
export function summarizeBills(
  bills: Array<Pick<Bill, "amount" | "dueDate" | "payments">>,
  today: string = new Date().toISOString().slice(0, 10),
): BillsSummary {
  let total = 0;
  let outstanding = 0;
  let overdue = 0;
  let upcoming = 0;
  let paidCount = 0;
  for (const b of bills) {
    total = round(total + b.amount);
    const rem = remaining(b);
    const status = billStatus(b, today);
    if (status === "paid") paidCount++;
    else {
      outstanding = round(outstanding + rem);
      if (b.dueDate < today) overdue = round(overdue + rem);
      else upcoming = round(upcoming + rem);
    }
  }
  return { count: bills.length, total, outstanding, overdue, upcoming, paidCount };
}

/** Sort bills by due date ascending, undated last. */
export function sortByDueDate<T extends { dueDate: string }>(bills: T[]): T[] {
  return [...bills].sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
}
