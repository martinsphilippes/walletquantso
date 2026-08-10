// WalletQuantso — faturamento automático dos Pedidos WhatsApp (lógica pura).
//
// Cruza as linhas convertidas da conversa com as regras do cliente
// (tela Clientes): cada linha é uma entrega, precificada pela tabela de
// bairros; as diárias são os turnos trabalhados — combinações distintas de
// Dia × Período (Manhã/Tarde/Noite) presentes na conversa — vezes o valor da
// diária. O usuário pode ajustar a quantidade de diárias antes de gerar o
// título.

import type { Client, DeliveryZone } from "@/types";
import type { ParsedRow } from "./parser";

const round = (n: number) => Math.round(n * 100) / 100;
const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

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
  total: number;
}

export function computeFaturamento(
  client: Client,
  rows: ParsedRow[],
  diariasOverride?: number,
): FaturamentoResult {
  // Entregas: preço por bairro (nome normalizado, sem acento/caixa).
  const zoneByName = new Map<string, DeliveryZone>();
  for (const z of client.zones ?? []) zoneByName.set(norm(z.name), z);

  let entregasValor = 0;
  const misses = new Map<string, number>();
  for (const r of rows) {
    const z = r.bairro ? zoneByName.get(norm(r.bairro)) : undefined;
    if (z) entregasValor += z.price;
    else misses.set(r.bairro || "—", (misses.get(r.bairro || "—") ?? 0) + 1);
  }

  // Diárias: um motoboy disponível em um turno = uma combinação Dia × Período.
  const shiftKeys = new Set<string>();
  const byPeriod = new Map<string, Set<string>>();
  for (const r of rows) {
    const periodo = r.periodo && r.periodo !== "—" ? r.periodo : "";
    shiftKeys.add(`${r.dia}|${periodo}`);
    const dias = byPeriod.get(periodo || "—") ?? new Set<string>();
    dias.add(r.dia);
    byPeriod.set(periodo || "—", dias);
  }
  const rate = client.dailyRate ?? 0;
  const diariasDetectadas = rate > 0 && rows.length > 0 ? shiftKeys.size : 0;
  const diarias = Math.max(0, diariasOverride ?? diariasDetectadas);
  const diariasValor = round(diarias * rate);

  const turnos = [...byPeriod.entries()].map(([p, dias]) => `${p} × ${dias.size}`);

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
    total: round(entregasValor + diariasValor),
  };
}
