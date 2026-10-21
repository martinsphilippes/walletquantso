// WalletQuantso — cálculo de cobrança de clientes (lógica pura).
//
// Recebe o que foi prestado no período (diárias por turno, entregas por
// bairro, faturamento entregue) e as regras do cliente, e devolve o valor
// total + a descrição pronta do título a receber. Sem I/O — testável.

import type { Client } from "@/types";

const round = (n: number) => Math.round(n * 100) / 100;

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export interface ChargeInput {
  /** Diárias no turno da manhã (um motoboy por diária). */
  morningShifts?: number;
  /** Diárias no turno da tarde. */
  afternoonShifts?: number;
  /** Entregas por bairro: id da zona → quantidade. */
  deliveries?: Record<string, number>;
  /** Faturamento entregue no período (para clientes com percentual). */
  revenue?: number | null;
  /**
   * Caminho inverso: o valor a cobrar já com o percentual aplicado. Quando
   * informado (> 0) vale ele, exato, e o faturamento é deduzido (valor ÷ %).
   */
  revenueValue?: number | null;
}

export interface Charge {
  total: number;
  /** Linhas descritivas para compor a descrição do título. */
  lines: string[];
}

/**
 * Parte do percentual sobre o faturamento: base (faturamento) e valor
 * cobrado, pelos dois caminhos — digitou o faturamento (valor = base × %) ou
 * digitou o valor (base = valor ÷ %). null quando não se aplica.
 */
export function revenueParts(client: Client, input: ChargeInput): { base: number; value: number } | null {
  const pct = client.revenuePercent ?? 0;
  if (pct <= 0) return null;
  const typedValue = input.revenueValue ?? 0;
  if (typedValue > 0) return { base: round((typedValue * 100) / pct), value: round(typedValue) };
  const revenue = input.revenue ?? 0;
  if (revenue > 0) return { base: round(revenue), value: round((revenue * pct) / 100) };
  return null;
}

/** Total e descrição da cobrança de um cliente para o que foi informado. */
export function computeCharge(client: Client, input: ChargeInput): Charge {
  let total = 0;
  const lines: string[] = [];

  const rate = client.dailyRate ?? 0;
  const morning = Math.max(0, Math.floor(input.morningShifts ?? 0));
  const afternoon = Math.max(0, Math.floor(input.afternoonShifts ?? 0));
  if (rate > 0 && morning + afternoon > 0) {
    total += (morning + afternoon) * rate;
    const parts: string[] = [];
    if (morning > 0) parts.push(`${morning} diária(s) manhã`);
    if (afternoon > 0) parts.push(`${afternoon} diária(s) tarde`);
    lines.push(parts.join(" + "));
  }

  for (const zone of client.zones ?? []) {
    const qty = Math.max(0, Math.floor(input.deliveries?.[zone.id] ?? 0));
    if (qty > 0 && zone.price > 0) {
      total += qty * zone.price;
      lines.push(`${qty}x ${zone.name}`);
    }
  }

  const rev = revenueParts(client, input);
  if (rev) {
    total += rev.value;
    lines.push(`${String(client.revenuePercent).replace(".", ",")}% de ${brl(rev.base)}`);
  }

  return { total: round(total), lines };
}

/** Descrição pronta do título ("Nome — linha1, linha2"). */
/** Periodicidade do título gerado para o cliente. */
export type ChargePeriod = "semanal" | "mensal";
export const CHARGE_PERIOD_LABEL: Record<ChargePeriod, string> = {
  semanal: "Semanal",
  mensal: "Mensal",
};

/** "Gialla — Semanal — 3 diária(s) manhã, …" (o tipo entra quando informado). */
export function chargeDescription(client: Client, charge: Charge, period?: ChargePeriod | null): string {
  const head = period ? `${client.name} — ${CHARGE_PERIOD_LABEL[period]}` : client.name;
  return charge.lines.length > 0 ? `${head} — ${charge.lines.join(", ")}` : head;
}
