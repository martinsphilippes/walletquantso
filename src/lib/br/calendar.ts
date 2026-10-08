// WalletQuantso — helpers de calendário em português (sem fuso horário).
//
// Tudo aqui trabalha com a data ISO (YYYY-MM-DD) como texto e só usa Date em
// UTC para contar dias da semana e dias do mês, então não sofre o desvio de
// "virou o dia às 21h" descrito em date.ts. Usado pelo DatePicker.

export const WEEKDAYS_LONG = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];

export const WEEKDAYS_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export const MONTHS_LONG = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

export function isIsoDate(s: string | null | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function partsOf(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function toIso(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Dias do mês (mês 1–12). */
export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 0 = domingo … 6 = sábado. */
export function weekdayOf(iso: string): number {
  const { y, m, d } = partsOf(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "quinta-feira, 8 de outubro de 2026" */
export function longDate(iso: string): string {
  const { y, m, d } = partsOf(iso);
  return `${WEEKDAYS_LONG[weekdayOf(iso)]}, ${d} de ${MONTHS_LONG[m - 1]} de ${y}`;
}

/** "qui, 08/10/2026" */
export function shortDate(iso: string): string {
  const { y, m, d } = partsOf(iso);
  return `${WEEKDAYS_SHORT[weekdayOf(iso)]}, ${pad(d)}/${pad(m)}/${y}`;
}

/** "outubro de 2026" */
export function monthTitle(y: number, m: number): string {
  return `${MONTHS_LONG[m - 1]} de ${y}`;
}

export function addMonths(y: number, m: number, delta: number): { y: number; m: number } {
  const idx = y * 12 + (m - 1) + delta;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}

/** Mesmo dia noutro mês, limitado ao último dia (31/jan + 1 → 28/fev). */
export function shiftMonth(iso: string, delta: number): string {
  const { y, m, d } = partsOf(iso);
  const n = addMonths(y, m, delta);
  return toIso(n.y, n.m, Math.min(d, daysInMonth(n.y, n.m)));
}

export function shiftDays(iso: string, delta: number): string {
  const { y, m, d } = partsOf(iso);
  const t = new Date(Date.UTC(y, m - 1, d + delta));
  return toIso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/**
 * Grade de 6 semanas (42 dias) do mês, começando no domingo da semana do dia
 * 1. Os dias fora do mês vêm com `inMonth: false`.
 */
export function monthGrid(y: number, m: number): { iso: string; inMonth: boolean }[] {
  const first = toIso(y, m, 1);
  const start = shiftDays(first, -weekdayOf(first));
  const out: { iso: string; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const iso = shiftDays(start, i);
    out.push({ iso, inMonth: iso.slice(0, 7) === first.slice(0, 7) });
  }
  return out;
}
