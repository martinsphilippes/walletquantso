// WalletQuantso — faturamento automático dos Pedidos WhatsApp (lógica pura).
//
// Cruza as linhas convertidas da conversa com as regras do cliente
// (tela Clientes): cada linha é uma entrega, precificada pela tabela de
// bairros; as diárias são os turnos trabalhados — combinações distintas de
// Dia × Período (Manhã/Tarde/Noite) presentes na conversa — vezes o valor da
// diária. O usuário pode ajustar a quantidade de diárias antes de gerar o
// título.

import type { Client, DeliveryZone } from "@/types";
import type { ParsedRow, ShiftRow } from "./parser";

const round = (n: number) => Math.round(n * 100) / 100;
const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// Casamento tolerante de bairro: normaliza, tira pontuação e palavras de
// ligação (da/das/de/...), reduz plural simples ("arvores" → "arvore").
// "Itaigara 2310 |", "Candeal- reenvio asa" e "Caminho da arvore »" casam
// com "Itaigara", "Candeal" e "Caminho das Arvores".
const ZONE_STOPWORDS = new Set(["da", "das", "de", "do", "dos", "e"]);
function zoneTokens(s: string): string[] {
  return norm(s)
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t && !ZONE_STOPWORDS.has(t))
    .map((t) => t.replace(/s$/, ""));
}

/** Zona da tabela cujos tokens são prefixo do bairro escrito (mais específica primeiro). */
function matchZone(
  bairro: string,
  zones: Array<{ zone: DeliveryZone; tokens: string[] }>,
): DeliveryZone | null {
  const b = zoneTokens(bairro);
  if (b.length === 0) return null;
  for (const { zone, tokens } of zones) {
    if (tokens.length === 0 || tokens.length > b.length) continue;
    let ok = true;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i] !== b[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return zone;
  }
  return null;
}

/** Faturamento de uma loja/canal (ex.: "Loja própria", "iFood"). */
export interface RevenueEntry {
  label: string;
  value: number;
}

export interface FaturamentoResult {
  /** Total de entregas (linhas convertidas). */
  entregas: number;
  /** Valor das entregas pela tabela de bairros do cliente. */
  entregasValor: number;
  /** Entregas cujo bairro não está na tabela (não somaram valor). */
  semPreco: Array<{ bairro: string; count: number }>;
  /** Diárias detectadas na conversa (turnos distintos de Dia × Período). */
  diariasDetectadas: number;
  /** Detalhe legível dos turnos, ex.: ["Noite × 3", "Manhã × 1"]. */
  turnos: string[];
  /** Diárias consideradas (override do usuário ou as detectadas). */
  diarias: number;
  diariasValor: number;
  /** Percentual sobre faturamento entregue (clientes com revenuePercent). */
  revenueBase: number | null;
  /** Divisão do faturamento por loja/canal, quando informado assim. */
  revenueParts: RevenueEntry[] | null;
  revenueValor: number;
  total: number;
}

export interface RowsSummary {
  /** Datas distintas em ordem cronológica (dd/mm/yyyy). */
  dias: string[];
  /** "07/08/2026 a 09/08/2026", data única, ou null. */
  period: string | null;
  /** Entregas por bairro, maiores contagens primeiro. */
  porBairro: Array<{ bairro: string; qty: number }>;
}

/** Período e entregas-por-bairro das linhas (para o histórico do cliente). */
export function summarizeRows(rows: ParsedRow[]): RowsSummary {
  const diasSet = new Set<string>();
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.dia) diasSet.add(r.dia);
    const b = r.bairro || "—";
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  const key = (d: string) => d.split("/").reverse().join("-");
  const dias = [...diasSet].sort((a, b) => key(a).localeCompare(key(b)));
  const period =
    dias.length === 0 ? null : dias.length === 1 ? dias[0] : `${dias[0]} a ${dias[dias.length - 1]}`;
  const porBairro = [...counts.entries()]
    .map(([bairro, qty]) => ({ bairro, qty }))
    .sort((x, y) => y.qty - x.qty);
  return { dias, period, porBairro };
}

/** Declarações de diária sem repetições (mesmo nome × turno × dia conta uma vez). */
export function dedupeShifts(shifts: ShiftRow[]): ShiftRow[] {
  const seen = new Set<string>();
  const out: ShiftRow[] = [];
  for (const s of shifts) {
    const k = `${s.dia}|${norm(s.periodo)}|${norm(s.name)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/** Preço de entrega de um bairro pela tabela do cliente (null = sem preço). */
export function zonePriceFor(client: Client, bairro: string): number | null {
  const zones = (client.zones ?? [])
    .map((zone) => ({ zone, tokens: zoneTokens(zone.name) }))
    .sort((a, b) => b.tokens.length - a.tokens.length);
  return matchZone(bairro, zones)?.price ?? null;
}

export function computeFaturamento(
  client: Client,
  rows: ParsedRow[],
  diariasOverride?: number,
  declaredShifts?: ShiftRow[],
  revenue?: number | RevenueEntry[] | null,
): FaturamentoResult {
  // Entregas: preço pela tabela de bairros, com casamento tolerante.
  const zones = (client.zones ?? [])
    .map((zone) => ({ zone, tokens: zoneTokens(zone.name) }))
    .sort((a, b) => b.tokens.length - a.tokens.length);

  let entregasValor = 0;
  const misses = new Map<string, number>();
  for (const r of rows) {
    const z = r.bairro ? matchZone(r.bairro, zones) : null;
    if (z) entregasValor += z.price;
    else misses.set(r.bairro || "—", (misses.get(r.bairro || "—") ?? 0) + 1);
  }

  const rate = client.dailyRate ?? 0;
  let diariasDetectadas: number;
  let turnos: string[];

  if (declaredShifts && declaredShifts.length > 0) {
    // Diárias declaradas na conversa ("Josias - manhã"): cada nome × turno ×
    // dia é uma diária (duplicatas de prints sobrepostos não contam duas vezes).
    const seen = new Set<string>();
    const byPeriod = new Map<string, number>();
    for (const s of declaredShifts) {
      const key = `${s.dia}|${norm(s.periodo)}|${norm(s.name)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      byPeriod.set(s.periodo, (byPeriod.get(s.periodo) ?? 0) + 1);
    }
    diariasDetectadas = rate > 0 ? seen.size : 0;
    turnos = [...byPeriod.entries()].map(([p, n]) => `${p} × ${n}`);
  } else {
    // Sem declarações: heurística por turnos distintos de Dia × Período.
    const shiftKeys = new Set<string>();
    const byPeriod = new Map<string, Set<string>>();
    for (const r of rows) {
      const periodo = r.periodo && r.periodo !== "—" ? r.periodo : "";
      shiftKeys.add(`${r.dia}|${periodo}`);
      const dias = byPeriod.get(periodo || "—") ?? new Set<string>();
      dias.add(r.dia);
      byPeriod.set(periodo || "—", dias);
    }
    diariasDetectadas = rate > 0 && rows.length > 0 ? shiftKeys.size : 0;
    turnos = [...byPeriod.entries()].map(
      ([p, dias]) => `${p === "—" ? "Dia" : p} × ${dias.size}`,
    );
  }

  const diarias = Math.max(0, diariasOverride ?? diariasDetectadas);
  const diariasValor = round(diarias * rate);

  // Percentual sobre o faturamento entregue (ex.: fábrica que paga 12%).
  // O faturamento pode vir num valor único ou dividido por loja/canal
  // (loja própria, iFood, ...): a soma de todas as lojas é a base do %.
  const pct = client.revenuePercent ?? 0;
  const parts = Array.isArray(revenue) ? revenue.filter((p) => p.value > 0) : null;
  const base = parts ? round(parts.reduce((s, p) => s + p.value, 0)) : (revenue as number | null | undefined) ?? 0;
  const revenueValor = pct > 0 && base > 0 ? round((base * pct) / 100) : 0;
  const revenueBase = pct > 0 && base > 0 ? base : null;
  const revenueParts = pct > 0 && base > 0 && parts && parts.length > 0 ? parts : null;

  return {
    entregas: rows.length,
    entregasValor: round(entregasValor),
    semPreco: [...misses.entries()]
      .map(([bairro, count]) => ({ bairro, count }))
      .sort((a, b) => b.count - a.count),
    diariasDetectadas,
    turnos,
    diarias,
    diariasValor,
    revenueBase,
    revenueParts,
    revenueValor,
    total: round(entregasValor + diariasValor + revenueValor),
  };
}
