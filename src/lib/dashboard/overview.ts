// WalletQuantso — integrated financial overview (pure logic).
//
// The dashboard must reflect BOTH ways the user records money:
//   • transactions (lançamentos)      — immediate, realized cash movements
//   • bills (contas a pagar/receber)  — planned obligations, settled by payments
//
// A bill settlement (BillPayment) is real cash leaving/entering an account, so
// it counts as "realized" exactly like a transaction. The still-open remainder
// of a bill is "planned" (a receber / a pagar). Keeping this here — free of I/O
// — mirrors the rest of the domain math (summarize, bill status, cash flow) and
// keeps it unit-testable.

import type { Account, Bill, Transaction } from "@/types";
import { unmaterializedPaid, remaining } from "@/lib/bills/status";
import { todayBr } from "@/lib/br/date";

export interface FinancialOverview {
  /** Sum of every account's opening balance. */
  initialBalance: number;
  /** Realized income: income transactions + amounts received on receivables. */
  realizedIncome: number;
  /** Realized expense: expense transactions + amounts paid on payables. */
  realizedExpense: number;
  /** initialBalance + realizedIncome − realizedExpense (transfers net to zero). */
  currentBalance: number;
  /** Outstanding (not-yet-settled) amount across open receivables. */
  toReceive: number;
  /** Outstanding (not-yet-settled) amount across open payables. */
  toPay: number;
  /** currentBalance + toReceive − toPay. */
  projectedBalance: number;
  /** Outstanding amount already past its due date (payables + receivables). */
  overdue: number;
  /** Number of bills not yet fully settled (open / partial / overdue). */
  pendingCount: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Optional date window applied to the overview:
 *  • realizadas — movements dated inside [from, to];
 *  • a receber/pagar, vencido, pendentes — bills DUE inside [from, to];
 *  • saldo atual — cumulative balance up to `to` (balances are point-in-time,
 *    so `from` never subtracts older movements from it).
 * Empty/absent bounds are open-ended; no period = whole history (as before).
 */
export interface OverviewPeriod {
  from?: string;
  to?: string;
}

/**
 * Combine accounts, transactions and bills into the numbers shown on the
 * dashboard. `today` is an ISO date (YYYY-MM-DD); defaults to the current day.
 */
export function computeOverview(
  accounts: Account[],
  txs: Transaction[],
  payables: Bill[],
  receivables: Bill[],
  today: string = todayBr(),
  period?: OverviewPeriod,
): FinancialOverview {
  const from = period?.from || "";
  const to = period?.to || "";
  const inPeriod = (d: string) => (!from || d >= from) && (!to || d <= to);
  const upToEnd = (d: string) => !to || d <= to;

  const initialBalance = round(
    accounts.reduce((sum, a) => sum + (a.initialBalance ?? 0), 0),
  );

  let realizedIncome = 0; // dentro do período
  let realizedExpense = 0;
  let cumIncome = 0; // até o fim do período (para o saldo)
  let cumExpense = 0;
  for (const t of txs) {
    // transfers move money between the user's own accounts → net zero for cash
    if (t.type === "income") {
      if (upToEnd(t.date)) cumIncome += t.amount;
      if (inPeriod(t.date)) realizedIncome += t.amount;
    } else if (t.type === "expense") {
      if (upToEnd(t.date)) cumExpense += t.amount;
      if (inPeriod(t.date)) realizedExpense += t.amount;
    }
  }
  // Settlements recorded on bills are realized cash movements. Once a baixa is
  // materialized as a transaction it is already counted in the loop above, so
  // only the not-yet-materialized part is added here.
  for (const b of receivables) {
    for (const p of b.payments) {
      if (p.transactionId) continue;
      const amt = p.amount || 0;
      if (upToEnd(p.date)) cumIncome += amt;
      if (inPeriod(p.date)) realizedIncome += amt;
    }
  }
  for (const b of payables) {
    for (const p of b.payments) {
      if (p.transactionId) continue;
      const amt = p.amount || 0;
      if (upToEnd(p.date)) cumExpense += amt;
      if (inPeriod(p.date)) realizedExpense += amt;
    }
  }
  realizedIncome = round(realizedIncome);
  realizedExpense = round(realizedExpense);

  const currentBalance = round(initialBalance + cumIncome - cumExpense);

  let toReceive = 0;
  let toPay = 0;
  let overdue = 0;
  let pendingCount = 0;

  for (const b of receivables) {
    const rem = remaining(b);
    if (rem <= 0 || !inPeriod(b.dueDate)) continue;
    toReceive += rem;
    pendingCount++;
    if (b.dueDate < today) overdue += rem;
  }
  for (const b of payables) {
    const rem = remaining(b);
    if (rem <= 0 || !inPeriod(b.dueDate)) continue;
    toPay += rem;
    pendingCount++;
    if (b.dueDate < today) overdue += rem;
  }
  toReceive = round(toReceive);
  toPay = round(toPay);
  overdue = round(overdue);

  const projectedBalance = round(currentBalance + toReceive - toPay);

  return {
    initialBalance,
    realizedIncome,
    realizedExpense,
    currentBalance,
    toReceive,
    toPay,
    projectedBalance,
    overdue,
    pendingCount,
  };
}
