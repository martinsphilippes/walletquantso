// WalletQuantso — relatório "Resultado por centro de custo" para o Telegram
// (lógica pura, sem I/O).
//
// Para cada centro de custo, soma as receitas e as despesas do mês corrente
// (até hoje) e mostra o resultado. O centro de custo vem do próprio
// lançamento; se faltar, da categoria (ou da categoria-mãe). Lançamentos sem
// nenhum dos dois ficam em "Sem centro de custo".

import type { Category, CostCenter, Transaction } from "@/types";
import { escapeHtml } from "./payables-telegram";

const MAX_MESSAGE = 3800;

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const round = (n: number) => Math.round(n * 100) / 100;

const MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export interface CostCenterResult {
  id: string | null;
  name: string;
  income: number;
  expense: number;
  result: number;
}

/** Centro de custo de um lançamento: o dele, ou o herdado da categoria. */
export function costCenterOf(t: Transaction, byCat: Map<string, Category>): string | null {
  if (t.costCenterId) return t.costCenterId;
  const cat = t.categoryId ? byCat.get(t.categoryId) : undefined;
  if (!cat) return null;
  if (cat.costCenterId) return cat.costCenterId;
  const parent = cat.parentId ? byCat.get(cat.parentId) : undefined;
  return parent?.costCenterId ?? null;
}

/** Receitas, despesas e resultado do mês de `todayIso` (até hoje) por centro de custo. */
export function resultByCostCenter(
  transactions: Transaction[],
  categories: Category[],
  costCenters: CostCenter[],
  todayIso: string,
): { month: string; rows: CostCenterResult[]; income: number; expense: number; result: number } {
  const month = todayIso.slice(0, 7);
  const byCat = new Map(categories.map((c) => [c.id!, c]));
  const ccName = new Map(costCenters.map((c) => [c.id!, c.name]));
  const rows = new Map<string, CostCenterResult>();

  for (const t of transactions) {
    if (t.type !== "income" && t.type !== "expense") continue;
    if (!t.date.startsWith(month) || t.date > todayIso) continue;
    const amount = Math.abs(t.amount || 0);
    if (!amount) continue;
    const ccId = costCenterOf(t, byCat);
    const key = ccId ?? "";
    let r = rows.get(key);
    if (!r) {
      r = {
        id: ccId,
        name: ccId ? (ccName.get(ccId) ?? "Centro removido") : "Sem centro de custo",
        income: 0,
        expense: 0,
        result: 0,
      };
      rows.set(key, r);
    }
    if (t.type === "income") r.income = round(r.income + amount);
    else r.expense = round(r.expense + amount);
    r.result = round(r.income - r.expense);
  }

  // Centros cadastrados sem movimento também aparecem (zerados), para se ver todos.
  for (const c of costCenters) {
    if (!rows.has(c.id!)) rows.set(c.id!, { id: c.id!, name: c.name, income: 0, expense: 0, result: 0 });
  }

  const out = [...rows.values()].sort((a, b) => {
    if (a.id === null) return 1;
    if (b.id === null) return -1;
    return b.income - a.income || b.expense - a.expense || a.name.localeCompare(b.name, "pt-BR");
  });
  const income = round(out.reduce((s, r) => s + r.income, 0));
  const expense = round(out.reduce((s, r) => s + r.expense, 0));
  return { month, rows: out, income, expense, result: round(income - expense) };
}

/** Mensagens HTML prontas para o Telegram, divididas no limite. */
export function buildCostCentersMessages(
  transactions: Transaction[],
  categories: Category[],
  costCenters: CostCenter[],
  todayIso: string,
): string[] {
  const { rows, income, expense, result } = resultByCostCenter(transactions, categories, costCenters, todayIso);
  const [y, m, d] = todayIso.split("-");
  const sign = (n: number) => (n >= 0 ? "🟢" : "🔴");
  const header =
    `<b>🏢 Resultado por centro de custo — ${MONTHS[Number(m) - 1]}/${y}</b> (até ${d}/${m})\n` +
    `Receitas <b>${brl(income)}</b> · Despesas <b>${brl(expense)}</b>\n` +
    `Resultado: ${sign(result)} <b>${brl(result)}</b>`;

  const messages: string[] = [];
  let current = header;
  const push = (chunk: string) => {
    if (current.length + chunk.length + 2 > MAX_MESSAGE) {
      messages.push(current);
      current = "";
    }
    current += (current ? "\n\n" : "") + chunk;
  };

  if (rows.length === 0) push("Nenhum lançamento neste mês até agora.");
  for (const r of rows) {
    const idle = r.income === 0 && r.expense === 0;
    const block = idle
      ? `▫️ <b>${escapeHtml(r.name)}</b> — sem movimento`
      : `${sign(r.result)} <b>${escapeHtml(r.name)}</b> — resultado <b>${brl(r.result)}</b>\n` +
        `   ↑ receitas ${brl(r.income)}\n` +
        `   ↓ despesas ${brl(r.expense)}`;
    push(block);
  }
  if (current) messages.push(current);
  return messages;
}
