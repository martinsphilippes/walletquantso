// WalletQuantso — bill repetition expansion (pure logic).
//
// A new payable/receivable can be created in one of three repetition modes:
//   • single       — a single title (lançamento único).
//   • fixed         — the same value repeats monthly on the same day for N
//                     occurrences (ex.: aluguel, assinatura).
//   • installments  — the total value is split automatically into N monthly
//                     parcelas (ex.: compra em 12x).
// This module turns the form input into the concrete list of titles to create.
// Kept free of I/O so the date/value math is unit-testable.

export type RepeatMode = "single" | "fixed" | "installments";

export interface RepeatBase {
  /** For single/fixed: the value of EACH title. For installments: the TOTAL. */
  amount: number;
  /** First due date (YYYY-MM-DD). */
  dueDate: string;
  /** First competence date (YYYY-MM-DD); defaults to the due date. */
  competenceDate?: string | null;
}

export interface ExpandedBill {
  amount: number;
  dueDate: string;
  competenceDate: string;
  /** Installment position, or null for single/fixed. */
  installment: { number: number; total: number } | null;
}

/** Add `n` months to an ISO date, keeping the day (clamped to the month end). */
export function addMonthsIso(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const anchor = new Date(Date.UTC(y, m - 1 + n, 1));
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth(); // 0-based
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Split `total` (BRL) into `count` parts in whole cents whose sum is exactly
 * `total`. The remainder cents are distributed to the first parcelas, so
 * earlier ones can be one cent higher.
 */
export function splitAmount(total: number, count: number): number[] {
  const n = Math.max(1, Math.floor(count));
  const totalCents = Math.round(total * 100);
  const base = Math.floor(totalCents / n);
  const remainder = totalCents - base * n;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const cents = base + (i < remainder ? 1 : 0);
    out.push(cents / 100);
  }
  return out;
}

/**
 * Expand a repetition spec into the concrete titles to create. `count` is
 * ignored for "single". Titles are spaced one month apart from `dueDate`.
 */
export function expandRepeat(base: RepeatBase, mode: RepeatMode, count = 1): ExpandedBill[] {
  const comp = base.competenceDate || base.dueDate;

  if (mode === "single") {
    return [{ amount: base.amount, dueDate: base.dueDate, competenceDate: comp, installment: null }];
  }

  const n = Math.max(1, Math.floor(count));

  if (mode === "fixed") {
    const out: ExpandedBill[] = [];
    for (let i = 0; i < n; i++) {
      out.push({
        amount: base.amount,
        dueDate: addMonthsIso(base.dueDate, i),
        competenceDate: addMonthsIso(comp, i),
        installment: null,
      });
    }
    return out;
  }

  // installments
  const parts = splitAmount(base.amount, n);
  return parts.map((amount, i) => ({
    amount,
    dueDate: addMonthsIso(base.dueDate, i),
    competenceDate: addMonthsIso(comp, i),
    installment: { number: i + 1, total: n },
  }));
}
