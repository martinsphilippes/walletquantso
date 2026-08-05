// WalletQuantso — timezone-safe "today" helpers (America/Sao_Paulo).
//
// `new Date().toISOString()` is UTC: from 21:00 in Brazil it already reads as
// TOMORROW, which shifted default dates, flagged due-today bills as overdue at
// night and flipped month panels on the last evening of the month (the same
// class of bug found in the Cora statement dates). Every "what day is it"
// decision must go through these helpers instead.

const DAY_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** ISO date (YYYY-MM-DD) of an instant, in Brazil's timezone. */
export function dateBr(d: Date = new Date()): string {
  return DAY_FMT.format(d);
}

/** Today's ISO date in Brazil. */
export function todayBr(): string {
  return dateBr(new Date());
}

/** Current month (YYYY-MM) in Brazil. */
export function currentMonthBr(): string {
  return todayBr().slice(0, 7);
}

/** ISO date N days ago, in Brazil's timezone. */
export function daysAgoBr(days: number): string {
  return dateBr(new Date(Date.now() - days * 86400000));
}

/**
 * First/last day of a month relative to today in Brazil (offset 0 = this
 * month, -1 = last month, +1 = next month). `base` (YYYY-MM-DD) is for tests.
 */
export function monthRangeBr(
  offset = 0,
  base: string = todayBr(),
): { from: string; to: string } {
  const [y, m] = base.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  const yy = d.getUTCFullYear();
  const mm = d.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return { from: `${yy}-${pad(mm)}-01`, to: `${yy}-${pad(mm)}-${pad(lastDay)}` };
}
