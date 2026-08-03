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
 * Combine accounts, transactions and bills into the numbers shown on the
 * dashboard. `today` is an ISO date (YYYY-MM-DD); defaults to the current day.
 */
export function computeOverview(
  accounts: Account[],
  txs: Transaction[],
  payables: Bill[],
  receivables: Bill[],
  today: string = new Date().toISOString().slice(0, 10),
): FinancialOverview {
  const initialBalance = round(
    accounts.reduce((sum, a) => sum + (a.initialBalance ?? 0), 0),
  );

  let realizedIncome = 0;
  let realizedExpense = 0;
  for (const t of txs) {
    if (t.type === "income") realizedIncome += t.amount;
    else if (t.type === "expense") realizedExpense += t.amount;
    // transfers move money between the user's own accounts → net zero for cash
  }
  // Settlements recorded on bills are realized cash movements. Once a baixa is
  // materialized as a transaction it is already counted in the loop above, so
  // only the not-yet-materialized part is added here.
  for (const b of receivables) realizedIncome += unmaterializedPaid(b);
  for (const b of payables) realizedExpense += unmaterializedPaid(b);
  realizedIncome = round(realizedIncome);
  realizedExpense = round(realizedExpense);

  const currentBalance = round(initialBalance + realizedIncome - realizedExpense);

  let toReceive = 0;
  let toPay = 0;
  let overdue = 0;
  let pendingCount = 0;

  for (const b of receivables) {
    const rem = remaining(b);
    if (rem <= 0) continue;
    toReceive += rem;
    pendingCount++;
    if (b.dueDate < today) overdue += rem;
  }
  for (const b of payables) {
    const rem = remaining(b);
    if (rem <= 0) continue;
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
