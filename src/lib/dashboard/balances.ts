// WalletQuantso — per-account balance computation (pure logic).
//
// Current balance = initial balance + net movements from transactions:
//   • income   → +amount on its account
//   • expense  → −amount on its account
//   • transfer → −amount on the source account, +amount on the destination
// Transactions referencing an unknown account id are collected separately so
// they are never silently dropped from the reconciliation.

import type { Account, Transaction } from "@/types";

export interface AccountBalance {
  accountId: string;
  name: string;
  initial: number;
  /** Net change from transactions. */
  movements: number;
  /** initial + movements. */
  current: number;
}

export interface BalancesResult {
  balances: AccountBalance[];
  /** Net movements attributed to account ids not present in `accounts`. */
  unassignedMovements: number;
  /** Sum of every account's current balance. */
  total: number;
}

export function computeBalances(
  accounts: Account[],
  txs: Transaction[],
): BalancesResult {
  const byId = new Map<string, AccountBalance>();
  for (const a of accounts) {
    if (!a.id) continue;
    byId.set(a.id, {
      accountId: a.id,
      name: a.name,
      initial: a.initialBalance ?? 0,
      movements: 0,
      current: 0,
    });
  }

  let unassignedMovements = 0;
  const apply = (accountId: string | null | undefined, delta: number) => {
    if (!accountId) return;
    const bal = byId.get(accountId);
    if (bal) bal.movements += delta;
    else unassignedMovements += delta;
  };

  for (const t of txs) {
    if (t.type === "income") apply(t.accountId, t.amount);
    else if (t.type === "expense") apply(t.accountId, -t.amount);
    else if (t.type === "transfer") {
      apply(t.accountId, -t.amount);
      apply(t.transferAccountId, t.amount);
    }
  }

  let total = 0;
  const balances = [...byId.values()].map((b) => {
    b.current = b.initial + b.movements;
    total += b.current;
    return b;
  });

  return { balances, unassignedMovements, total };
}
