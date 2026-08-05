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
