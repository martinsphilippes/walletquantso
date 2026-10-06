// WalletQuantso — taxa de conta (ex.: Depix) — lógica pura.
//
// Algumas contas consomem uma parte de cada operação: um percentual e/ou um
// valor fixo, configurados na própria conta e ligados por tipo de operação
// (receita, despesa, transferência). Quem paga a taxa é sempre o dono:
//   • despesa       → sai da conta o valor + a taxa;
//   • receita       → entra na conta o valor − a taxa;
//   • transferência → chega no destino o valor − a taxa.
// O lançamento principal mantém o valor do negócio ("valor lançado"); a taxa
// vira um lançamento de despesa à parte, na conta que cobra a taxa. Numa
// transferência que SAI da conta com taxa, o principal leva valor − taxa
// (o que chega no destino) e a taxa sai da origem: a origem perde o valor
// cheio e o destino recebe o líquido.

import type { Account, AccountFee, LinkedFee, TransactionType } from "@/types";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A conta tem taxa configurada para este tipo de operação? */
export function feeApplies(fee: AccountFee | null | undefined, type: TransactionType): boolean {
  if (!fee) return false;
  if ((fee.percent ?? 0) <= 0 && (fee.fixed ?? 0) <= 0) return false;
  if (type === "income") return !!fee.onIncome;
  if (type === "expense") return !!fee.onExpense;
  return !!fee.onTransfer;
}

/**
 * Conta que cobra a taxa nesta operação, ou null. Numa transferência vale a
 * origem; se só o destino tiver taxa, vale o destino.
 */
export function feeAccountFor(
  type: TransactionType,
  accountId: string,
  transferAccountId: string | null | undefined,
  accounts: Account[],
): { account: Account; isSource: boolean } | null {
  const byId = (id: string | null | undefined) => (id ? accounts.find((a) => a.id === id) : undefined);
  const src = byId(accountId);
  if (src && feeApplies(src.fee, type)) return { account: src, isSource: true };
  if (type === "transfer") {
    const dst = byId(transferAccountId);
    if (dst && feeApplies(dst.fee, type)) return { account: dst, isSource: false };
  }
  return null;
}

/** Taxa calculada: valor × percentual + fixo (em centavos). */
export function computeFee(gross: number, fee: AccountFee): number {
  if (!(gross > 0)) return 0;
  return round2(gross * ((fee.percent ?? 0) / 100) + (fee.fixed ?? 0));
}

/** Valor realizado (o que de fato sai/entra/chega) a partir da taxa. */
export function realizedFromFee(type: TransactionType, gross: number, fee: number): number {
  return round2(type === "expense" ? gross + fee : gross - fee);
}

/** Taxa a partir do valor realizado digitado. */
export function feeFromRealized(type: TransactionType, gross: number, realized: number): number {
  return round2(type === "expense" ? realized - gross : gross - realized);
}

/**
 * Percentual "aprendido" quando o usuário corrige a taxa: mantém o valor
 * fixo e recalcula o percentual que explica a taxa informada (4 casas).
 */
export function learnedPercent(gross: number, fee: number, fixed: number): number {
  if (!(gross > 0)) return 0;
  const pct = ((fee - (fixed ?? 0)) / gross) * 100;
  return Math.max(0, Math.round(pct * 10000) / 10000);
}

/** Valor do lançamento principal: o líquido só na transferência que sai da conta com taxa. */
export function mainAmount(type: TransactionType, gross: number, fee: number, feeOnSource: boolean): number {
  return round2(type === "transfer" && feeOnSource ? gross - fee : gross);
}

/** "2,5% + R$ 1,00" para rótulos. */
export function describeFee(fee: AccountFee): string {
  const parts: string[] = [];
  if ((fee.percent ?? 0) > 0) parts.push(`${fee.percent.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%`);
  if ((fee.fixed ?? 0) > 0) {
    parts.push(fee.fixed.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
  }
  return parts.join(" + ") || "sem taxa";
}

// ── Regras vinculadas (gasto em outra conta) ───────────────────────────────


export interface LinkedCharge {
  rule: LinkedFee;
  /** Conta que gerou a regra (a usada na operação). */
  sourceAccount: Account;
  /** Conta que gasta. */
  targetAccount: Account | undefined;
  amount: number;
}

/**
 * Gastos em outras contas disparados por esta operação: regras da conta da
 * operação (e, numa transferência, também da conta de destino) marcadas
 * para este tipo, com valor > 0. Uma regra apontando para a própria conta é
 * ignorada (para isso existe a taxa própria).
 */
export function linkedChargesFor(
  type: TransactionType,
  accountId: string,
  transferAccountId: string | null | undefined,
  gross: number,
  accounts: Account[],
): LinkedCharge[] {
  const byId = (id: string | null | undefined) => (id ? accounts.find((a) => a.id === id) : undefined);
  const sources = [byId(accountId)];
  if (type === "transfer") sources.push(byId(transferAccountId));
  const out: LinkedCharge[] = [];
  for (const src of sources) {
    for (const rule of src?.linkedFees ?? []) {
      if (rule.accountId === src!.id) continue;
      const on = type === "income" ? rule.onIncome : type === "expense" ? rule.onExpense : rule.onTransfer;
      if (!on) continue;
      const amount = round2(gross * ((rule.percent ?? 0) / 100) + (rule.fixed ?? 0));
      if (amount <= 0) continue;
      out.push({ rule, sourceAccount: src!, targetAccount: byId(rule.accountId), amount });
    }
  }
  return out;
}

/** "2% + R$ 1,00" para uma regra vinculada. */
export function describeLinkedFee(rule: LinkedFee): string {
  return describeFee({ ...rule, categoryId: null, costCenterId: null });
}
