// WalletQuantso — reconciliation of transfers and installments.
//
// Pure, side-effect-free transforms applied to the importable rows before
// commit. They refine (not fabricate) data:
//   • Transfers: an outflow in one account plus a matching inflow in another
//     account are merged into a single `transfer` transaction.
//   • Installments: rows like "3/12" for the same purchase are grouped under a
//     shared installmentGroupId so the series is recognizable.
// Everything is reversible in the preview because it operates on a copy.

import { dedupHash, normalizeHeader, type NormalizedRow } from "./engine";

/** Days between two ISO (YYYY-MM-DD) dates, absolute value. */
function dayGap(a: string, b: string): number {
  const da = Date.parse(a + "T00:00:00Z");
  const db = Date.parse(b + "T00:00:00Z");
  if (Number.isNaN(da) || Number.isNaN(db)) return Infinity;
  return Math.abs(da - db) / 86400000;
}

const TRANSFER_HINTS =
  /(transfer|transferencia|ted|doc|pix|aplicacao|aplicação|resgate|entre contas)/i;

export interface TransferOptions {
  /** Maximum number of days between the two legs to count as a pair. */
  maxDayGap?: number;
}

export interface ReconcileResult {
  rows: NormalizedRow[];
  transfersFound: number;
  installmentGroupsFound: number;
}

/**
 * Merge outflow/inflow pairs into single transfer rows.
 *
 * A pair is: an `expense` row and an `income` row with the same absolute
 * amount, in different accounts, within `maxDayGap` days. The lower row number
 * (usually the outflow) becomes the transfer's source account; the other its
 * destination. Rows already typed as `transfer` are left untouched.
 */
export function reconcileTransfers(
  input: NormalizedRow[],
  opts: TransferOptions = {},
): { rows: NormalizedRow[]; transfersFound: number } {
  const maxDayGap = opts.maxDayGap ?? 3;
  const matched = new Set<number>(); // indices consumed
  const transferFor = new Map<number, NormalizedRow>(); // expense index -> merged row
  const dropIncome = new Set<number>(); // income index -> removed

  const cents = (n: number) => Math.round(Math.abs(n) * 100);

  for (let i = 0; i < input.length; i++) {
    const ri = input[i];
    if (matched.has(i) || !ri.transaction || ri.transaction.type !== "expense") continue;
    const ti = ri.transaction;

    let bestJ = -1;
    let bestScore = Infinity;
    for (let j = 0; j < input.length; j++) {
      if (j === i || matched.has(j)) continue;
      const rj = input[j];
      if (!rj.transaction || rj.transaction.type !== "income") continue;
      const tj = rj.transaction;
      if (cents(ti.amount) !== cents(tj.amount)) continue;
      if (normalizeHeader(ti.accountId) === normalizeHeader(tj.accountId)) continue;
      const gap = dayGap(ti.date, tj.date);
      if (gap > maxDayGap) continue;
      // Prefer the smallest date gap; a transfer keyword breaks ties.
      const hinted = TRANSFER_HINTS.test(ti.description) || TRANSFER_HINTS.test(tj.description);
      const score = gap - (hinted ? 0.5 : 0);
      if (score < bestScore) {
        bestScore = score;
        bestJ = j;
      }
    }

    if (bestJ >= 0) {
      const rj = input[bestJ];
      const tj = rj.transaction!;
      matched.add(i);
      matched.add(bestJ);
      dropIncome.add(bestJ);

      const description = ti.description || tj.description || "Transferência";
      transferFor.set(i, {
        rowNumber: ri.rowNumber,
        errors: [],
        warnings: [
          ...ri.warnings,
          `Transferência reconciliada (linha ${ri.rowNumber} → linha ${rj.rowNumber}).`,
        ],
        transaction: {
          ...ti,
          type: "transfer",
          description,
          transferAccountId: tj.accountId, // destination
          categoryId: null,
          dedupHash: dedupHash({
            date: ti.date,
            amount: ti.amount,
            description,
            account: ti.accountId,
          }),
        },
      });
    }
  }

  const rows: NormalizedRow[] = [];
  for (let i = 0; i < input.length; i++) {
    if (dropIncome.has(i)) continue;
    rows.push(transferFor.get(i) ?? input[i]);
  }
  return { rows, transfersFound: transferFor.size };
}

/** Remove a trailing installment marker like "3/12" or "(3/12)" from text. */
export function stripInstallmentSuffix(desc: string): string {
  return desc
    .replace(/\(?\s*parcela\s*\d+\s*\/\s*\d+\s*\)?/i, "")
    .replace(/\(?\s*\d+\s*\/\s*\d+\s*\)?\s*$/, "")
    .trim();
}

/**
 * Assign a shared installmentGroupId to rows that belong to the same
 * installment series (same base description, same total, same account).
 */
export function reconcileInstallments(input: NormalizedRow[]): {
  rows: NormalizedRow[];
  installmentGroupsFound: number;
} {
  const keyOf = (r: NormalizedRow): string | null => {
    const t = r.transaction;
    if (!t?.installment) return null;
    const base = normalizeHeader(stripInstallmentSuffix(t.description));
    return `${base}|${t.installment.total}|${normalizeHeader(t.accountId)}`;
  };

  const groupIds = new Map<string, string>();
  for (const r of input) {
    const key = keyOf(r);
    if (key && !groupIds.has(key)) {
      // Deterministic id from the group key.
      groupIds.set(key, dedupHash({ date: key, amount: 0, description: key, account: "" }));
    }
  }

  const rows = input.map((r) => {
    const key = keyOf(r);
    if (!key || !r.transaction) return r;
    return {
      ...r,
      transaction: { ...r.transaction, installmentGroupId: groupIds.get(key)! },
    };
  });

  return { rows, installmentGroupsFound: groupIds.size };
}

/** Run both reconciliations: transfers first, then installments. */
export function reconcile(
  input: NormalizedRow[],
  opts: TransferOptions = {},
): ReconcileResult {
  const t = reconcileTransfers(input, opts);
  const inst = reconcileInstallments(t.rows);
  return {
    rows: inst.rows,
    transfersFound: t.transfersFound,
    installmentGroupsFound: inst.installmentGroupsFound,
  };
}
