// WalletQuantso — pagamento de motoristas (lógica pura).
//
// Cada empresa (cliente) tem a própria regra de pagamento ao motorista: valor
// por diária, uma ou mais TAXAS de corrida (ex.: "Normal" R$ 8, "Longa"
// R$ 12) e o vencimento (dia do mês ou próximo dia da semana). Soma as
// corridas em aberto de um motorista naquela empresa e calcula o vencimento.

import type { ClientPayRule, DriverSettings, RideEntry, RideRate } from "@/types";

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

/** Vencimento conforme a regra: dia do mês ou dia da semana. */
export function payDueDate(
  todayIso: string,
  rule: { payMode?: "monthDay" | "weekday"; payDay?: number; payWeekday?: number },
): string {
  if (rule.payMode === "weekday") return nextWeekdayDate(todayIso, rule.payWeekday ?? 1);
  return nextPayDate(todayIso, rule.payDay ?? 5);
}

/** Rótulo humano do vencimento: "Hoje", "Amanhã (16/09)" ou "terça-feira, 22/09". */
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

/** Taxas de corrida da regra (o valor único antigo vira uma taxa "Corrida"). */
export function ratesOf(rule: ClientPayRule): RideRate[] {
  if (rule.rates && rule.rates.length > 0) return rule.rates;
  if ((rule.corridaValue ?? 0) > 0) return [{ id: "default", label: "Corrida", value: rule.corridaValue! }];
  return [];
}

/**
 * Regra de pagamento de uma empresa: a específica dela; na falta, a de uma
 * regra compartilhada antiga que a inclua; na falta, a regra única da
 * primeira versão (se tiver valor). Sempre com `rates` preenchido.
 */
export function ruleForClient(
  settings: DriverSettings | null,
  clientId: string,
): ClientPayRule | null {
  if (!settings) return null;
  const norm = (r: ClientPayRule): ClientPayRule => ({ ...r, rates: ratesOf(r) });
  const own = settings.byClient?.[clientId];
  if (own) return norm(own);
  const shared = settings.rules?.find((r) => r.clientIds?.includes(clientId));
  if (shared) return norm(shared);
  if ((settings.diariaValue ?? 0) > 0 || (settings.corridaValue ?? 0) > 0) {
    return norm({
      payMode: settings.payMode ?? "monthDay",
      payDay: settings.payDay ?? 5,
      payWeekday: settings.payWeekday ?? 1,
      diariaValue: settings.diariaValue ?? 0,
      corridaValue: settings.corridaValue ?? 0,
      rates: [],
    });
  }
  return null;
}

export interface DriverPayout {
  diarias: number;
  corridas: number;
  diariasValor: number;
  corridasValor: number;
  total: number;
  /** "05/09/2026 a 12/09/2026", data única ou null (sem corridas). */
  period: string | null;
  /** Corridas por taxa (só as que tiveram quantidade). */
  porTaxa: Array<{ id: string; label: string; value: number; qty: number; total: number }>;
  rideIds: string[];
}

/**
 * Soma as corridas ainda sem título (billId nulo) de um motorista numa
 * empresa, pelos valores da regra daquela empresa (diária + cada taxa).
 * Lançamentos antigos sem taxa contam na primeira taxa da regra.
 */
export function computeDriverPayout(
  rides: RideEntry[],
  driverId: string,
  clientId: string,
  rule: ClientPayRule,
): DriverPayout {
  const open = rides.filter((r) => r.driverId === driverId && r.clientId === clientId && !r.billId);
  const rates = ratesOf(rule);
  const byRate = new Map<string, { id: string; label: string; value: number; qty: number }>();
  for (const rt of rates) byRate.set(rt.id, { ...rt, qty: 0 });
  const bump = (rateId: string, qty: number) => {
    if (!qty) return;
    let b = byRate.get(rateId);
    if (!b) {
      b = { id: rateId, label: "taxa removida", value: 0, qty: 0 };
      byRate.set(rateId, b);
    }
    b.qty += qty;
  };

  let diarias = 0;
  const dias = new Set<string>();
  for (const r of open) {
    diarias += r.diarias || 0;
    if (r.date) dias.add(r.date);
    if (r.corridasPorTaxa && Object.keys(r.corridasPorTaxa).length > 0) {
      for (const [rateId, qty] of Object.entries(r.corridasPorTaxa)) bump(rateId, qty || 0);
    } else if (r.corridas) {
      bump(rates[0]?.id ?? "default", r.corridas);
    }
  }
  const ordered = [...dias].sort();
  const br = (iso: string) => iso.split("-").reverse().join("/");
  const period =
    ordered.length === 0
      ? null
      : ordered.length === 1
        ? br(ordered[0])
        : `${br(ordered[0])} a ${br(ordered[ordered.length - 1])}`;

  const porTaxa = [...byRate.values()]
    .filter((b) => b.qty > 0)
    .map((b) => ({ ...b, total: round(b.qty * b.value) }));
  const corridas = porTaxa.reduce((s, b) => s + b.qty, 0);
  const corridasValor = round(porTaxa.reduce((s, b) => s + b.total, 0));
  const diariasValor = round(diarias * (rule.diariaValue || 0));
  return {
    diarias,
    corridas,
    diariasValor,
    corridasValor,
    total: round(diariasValor + corridasValor),
    period,
    porTaxa,
    rideIds: open.map((r) => r.id!).filter(Boolean),
  };
}
