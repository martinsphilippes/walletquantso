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
