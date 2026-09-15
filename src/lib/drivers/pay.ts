// WalletQuantso — pagamento de motoristas (lógica pura).
//
// Soma as corridas em aberto de um motorista (diárias e corridas por
// empresa) pelos valores configurados e calcula o vencimento no dia de
// pagamento definido pelo dono.

import type { RideEntry } from "@/types";

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Próximo vencimento no dia `payDay` a partir de `todayIso`: o próprio mês
 * se o dia ainda não passou (hoje conta), senão o mês seguinte. Dia 31 em
 * meses curtos vira o último dia do mês.
 */
export function nextPayDate(todayIso: string, payDay: number): string {
  const [y, m, d] = todayIso.split("-").map(Number);
  const day = Math.min(31, Math.max(1, Math.floor(payDay)));
  let year = y;
  let month = m;
  if (d > day) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const dd = Math.min(day, lastDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

export const WEEKDAY_NAMES = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
] as const;

/**
 * Próxima ocorrência do dia da semana `weekday` (0 = domingo … 6 = sábado)
 * a partir de `todayIso` — se hoje já é esse dia, é hoje.
 */
export function nextWeekdayDate(todayIso: string, weekday: number): string {
  const [y, m, d] = todayIso.split("-").map(Number);
  const wd = ((Math.floor(weekday) % 7) + 7) % 7;
  const base = new Date(Date.UTC(y, m - 1, d));
  const diff = (wd - base.getUTCDay() + 7) % 7;
  base.setUTCDate(base.getUTCDate() + diff);
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, "0")}-${String(
    base.getUTCDate(),
  ).padStart(2, "0")}`;
}

/** Vencimento conforme a configuração: dia do mês ou dia da semana. */
export function payDueDate(
  todayIso: string,
  settings: { payMode?: "monthDay" | "weekday"; payDay: number; payWeekday?: number },
): string {
  if (settings.payMode === "weekday") return nextWeekdayDate(todayIso, settings.payWeekday ?? 1);
  return nextPayDate(todayIso, settings.payDay);
}

/** Rótulo humano do vencimento: "Hoje", "Amanhã" ou "terça-feira, 22/09". */
export function describeDue(todayIso: string, dueIso: string): string {
  if (dueIso === todayIso) return "Hoje";
  const [y, m, d] = dueIso.split("-").map(Number);
  const due = new Date(Date.UTC(y, m - 1, d));
  const [ty, tm, td] = todayIso.split("-").map(Number);
  const today = new Date(Date.UTC(ty, tm - 1, td));
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  const br = `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
  if (days === 1) return `Amanhã (${br})`;
  return `${WEEKDAY_NAMES[due.getUTCDay()]}, ${br}`;
}

export interface DriverPayout {
  diarias: number;
  corridas: number;
  diariasValor: number;
  corridasValor: number;
  total: number;
  /** "05/09/2026 a 12/09/2026", data única ou null (sem corridas). */
  period: string | null;
  /** Detalhe por empresa (clientId), maiores primeiro. */
  porEmpresa: Array<{ clientId: string; diarias: number; corridas: number }>;
  rideIds: string[];
}

/** Soma as corridas ainda sem título (billId nulo) de um motorista. */
export function computeDriverPayout(
  rides: RideEntry[],
  driverId: string,
  rates: { diariaValue: number; corridaValue: number },
): DriverPayout {
  const open = rides.filter((r) => r.driverId === driverId && !r.billId);
  let diarias = 0;
  let corridas = 0;
  const byClient = new Map<string, { diarias: number; corridas: number }>();
  const dias = new Set<string>();
  for (const r of open) {
    diarias += r.diarias || 0;
    corridas += r.corridas || 0;
    if (r.date) dias.add(r.date);
    const c = byClient.get(r.clientId) ?? { diarias: 0, corridas: 0 };
    c.diarias += r.diarias || 0;
    c.corridas += r.corridas || 0;
    byClient.set(r.clientId, c);
  }
  const ordered = [...dias].sort();
  const br = (iso: string) => iso.split("-").reverse().join("/");
  const period =
    ordered.length === 0
      ? null
      : ordered.length === 1
        ? br(ordered[0])
        : `${br(ordered[0])} a ${br(ordered[ordered.length - 1])}`;
  const diariasValor = round(diarias * (rates.diariaValue || 0));
  const corridasValor = round(corridas * (rates.corridaValue || 0));
  return {
    diarias,
    corridas,
    diariasValor,
    corridasValor,
    total: round(diariasValor + corridasValor),
    period,
    porEmpresa: [...byClient.entries()]
      .map(([clientId, c]) => ({ clientId, ...c }))
      .sort((a, b) => b.diarias + b.corridas - (a.diarias + a.corridas)),
    rideIds: open.map((r) => r.id!).filter(Boolean),
  };
}
