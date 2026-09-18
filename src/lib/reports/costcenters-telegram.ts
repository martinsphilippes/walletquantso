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

// ── Detalhe de um centro de custo ─────────────────────────────────────────

const normalize = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** Centros cujo nome contém o texto pedido (sem acento e sem maiúsculas). */
export function findCostCenters(costCenters: CostCenter[], query: string): CostCenter[] {
  const q = normalize(query);
  if (!q) return [];
  const exact = costCenters.filter((c) => normalize(c.name) === q);
  if (exact.length > 0) return exact;
  return costCenters.filter((c) => normalize(c.name).includes(q));
}

interface CatLine {
  id: string | null;
  name: string;
  total: number;
  subs: Array<{ id: string; name: string; total: number }>;
}

function sumByCategory(txs: Transaction[], byCat: Map<string, Category>): CatLine[] {
  const groups = new Map<string, CatLine>();
  for (const t of txs) {
    const amount = Math.abs(t.amount || 0);
    if (!amount) continue;
    const cat = t.categoryId ? byCat.get(t.categoryId) : undefined;
    if (!cat) {
      const g = groups.get("") ?? { id: null, name: "Sem categoria", total: 0, subs: [] };
      g.total = round(g.total + amount);
      groups.set("", g);
      continue;
    }
    const parent = cat.parentId ? byCat.get(cat.parentId) : undefined;
    const root = parent ?? cat;
    const g = groups.get(root.id!) ?? { id: root.id!, name: root.name, total: 0, subs: [] };
    g.total = round(g.total + amount);
    if (parent) {
      const s = g.subs.find((x) => x.id === cat.id) ?? { id: cat.id!, name: cat.name, total: 0 };
      if (!g.subs.includes(s)) g.subs.push(s);
      s.total = round(s.total + amount);
    }
    groups.set(root.id!, g);
  }
  const out = [...groups.values()];
  for (const g of out) g.subs.sort((a, b) => b.total - a.total);
  return out.sort((a, b) => {
    if (a.id === null) return 1;
    if (b.id === null) return -1;
    return b.total - a.total || a.name.localeCompare(b.name, "pt-BR");
  });
}

/**
 * Mensagens com o detalhe de UM centro de custo no mês (até hoje): receitas
 * por categoria e despesas por categoria (com subcategorias e percentual).
 * Se o texto casar com vários centros, lista as opções; se com nenhum,
 * lista os centros existentes.
 */
export function buildCostCenterDetailMessages(
  transactions: Transaction[],
  categories: Category[],
  costCenters: CostCenter[],
  todayIso: string,
  query: string,
): string[] {
  const all = costCenters.map((c) => escapeHtml(c.name)).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const matches = findCostCenters(costCenters, query);
  if (!query.trim() || matches.length === 0) {
    return [
      `${query.trim() ? `Nenhum centro de custo chamado "<b>${escapeHtml(query.trim())}</b>".\n\n` : ""}` +
        `Centros de custo: ${all.join(" · ") || "nenhum cadastrado"}.\n\nUse <code>/centro nome</code>, ex.: <code>/centro ${all[0] ?? "Gialla"}</code>.`,
    ];
  }
  if (matches.length > 1) {
    return [
      `Vários centros combinam com "<b>${escapeHtml(query.trim())}</b>": ${matches.map((c) => escapeHtml(c.name)).join(" · ")}. Escreva o nome mais completo.`,
    ];
  }
  const cc = matches[0];
  const month = todayIso.slice(0, 7);
  const byCat = new Map(categories.map((c) => [c.id!, c]));
  const inMonth = transactions.filter(
    (t) =>
      (t.type === "income" || t.type === "expense") &&
      t.date.startsWith(month) &&
      t.date <= todayIso &&
      costCenterOf(t, byCat) === cc.id,
  );
  const incomes = sumByCategory(inMonth.filter((t) => t.type === "income"), byCat);
  const expenses = sumByCategory(inMonth.filter((t) => t.type === "expense"), byCat);
  const income = round(incomes.reduce((s, g) => s + g.total, 0));
  const expense = round(expenses.reduce((s, g) => s + g.total, 0));
  const result = round(income - expense);
  const [y, m, d] = todayIso.split("-");
  const sign = result >= 0 ? "🟢" : "🔴";

  const header =
    `<b>🏢 ${escapeHtml(cc.name)} — ${MONTHS[Number(m) - 1]}/${y}</b> (até ${d}/${m})\n` +
    `Receitas <b>${brl(income)}</b> · Despesas <b>${brl(expense)}</b>\n` +
    `Resultado: ${sign} <b>${brl(result)}</b> · ${inMonth.length} lançamento(s)`;

  const messages: string[] = [];
  let current = header;
  const push = (chunk: string) => {
    if (current.length + chunk.length + 2 > MAX_MESSAGE) {
      messages.push(current);
      current = "";
    }
    current += (current ? "\n\n" : "") + chunk;
  };
  const section = (title: string, lines: CatLine[], total: number) => {
    if (lines.length === 0) {
      push(`<b>${title}</b>\n   nenhum lançamento`);
      return;
    }
    let block = `<b>${title}</b>`;
    for (const g of lines) {
      const pct = total > 0 ? Math.round((g.total / total) * 100) : 0;
      block += `\n🏷 ${escapeHtml(g.name)} — <b>${brl(g.total)}</b> (${pct}%)`;
      for (const s of g.subs) block += `\n      ↳ ${escapeHtml(s.name)} — ${brl(s.total)}`;
    }
    push(block);
  };
  section("↑ Receitas por categoria", incomes, income);
  section("↓ Despesas por categoria", expenses, expense);
  if (current) messages.push(current);
  return messages;
}
