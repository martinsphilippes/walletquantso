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
}

export interface Charge {
  total: number;
  /** Linhas descritivas para compor a descrição do título. */
  lines: string[];
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

  const pct = client.revenuePercent ?? 0;
  const revenue = input.revenue ?? 0;
  if (pct > 0 && revenue > 0) {
    total += (revenue * pct) / 100;
    lines.push(`${String(pct).replace(".", ",")}% de ${brl(revenue)}`);
  }

  return { total: round(total), lines };
}

/** Descrição pronta do título ("Nome — linha1, linha2"). */
export function chargeDescription(client: Client, charge: Charge): string {
  return charge.lines.length > 0
    ? `${client.name} — ${charge.lines.join(", ")}`
    : client.name;
}
