// WalletQuantso — chart math (pure).
//
// Turns aggregated report data into the numbers a chart needs (donut segment
// fractions, running balance). No rendering here so the math is testable.

import type { MonthTotal } from "./aggregate";

export interface DonutSegment {
  /** Fraction of the whole, 0..1. */
  fraction: number;
  /** Cumulative fraction before this segment (its start), 0..1. */
  offset: number;
}

/**
 * Convert a list of non-negative values into donut segments. Each segment gets
 * its fraction of the total and the cumulative offset where it starts. An
 * all-zero (or empty) input yields zero-width segments.
 */
export function donutSegments(values: number[]): DonutSegment[] {
  const total = values.reduce((s, v) => s + Math.max(0, v), 0);
  const segments: DonutSegment[] = [];
  let offset = 0;
  for (const v of values) {
    const fraction = total > 0 ? Math.max(0, v) / total : 0;
    segments.push({ fraction, offset });
    offset += fraction;
  }
  return segments;
}

export interface CumulativePoint {
  month: string;
  /** The month's own net (income − expense). */
  balance: number;
  /** Running total up to and including this month. */
  cumulative: number;
}

/** Running balance across months (assumes months are already sorted asc). */
export function cumulativeBalance(months: MonthTotal[]): CumulativePoint[] {
  let running = 0;
  return months.map((m) => {
    running += m.balance;
    return { month: m.month, balance: m.balance, cumulative: running };
  });
}
