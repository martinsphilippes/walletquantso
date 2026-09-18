// WalletQuantso — relatório "Gastos por categoria" para o Telegram
// (lógica pura, sem I/O).
//
// Soma as despesas (lançamentos do tipo "expense") do mês corrente, até a
// data de hoje, por categoria. Subcategorias aparecem indentadas dentro da
// categoria-mãe; categorias de despesa sem lançamento no mês são listadas ao
// final, de forma compacta, para se saber que existem.

import type { Category, Transaction } from "@/types";
import { escapeHtml } from "./payables-telegram";

const MAX_MESSAGE = 3800;

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const round = (n: number) => Math.round(n * 100) / 100;

const MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export interface CategorySpend {
  id: string | null;
  name: string;
  total: number;
  subs: Array<{ id: string; name: string; total: number }>;
}

/**
 * Gastos do mês de `todayIso` (até hoje inclusive) por categoria-mãe, com
 * o detalhe por subcategoria. Lançamentos sem categoria viram "Sem
 * categoria". Ordenado do maior para o menor gasto.
 */
export function spendByCategory(
  transactions: Transaction[],
  categories: Category[],
  todayIso: string,
): { month: string; groups: CategorySpend[]; total: number; idle: string[] } {
  const month = todayIso.slice(0, 7);
  const byId = new Map(categories.map((c) => [c.id!, c]));
  const groups = new Map<string, CategorySpend>();

  const groupFor = (rootId: string | null, name: string) => {
    const key = rootId ?? "";
    let g = groups.get(key);
    if (!g) {
      g = { id: rootId, name, total: 0, subs: [] };
      groups.set(key, g);
    }
    return g;
  };

  for (const t of transactions) {
    if (t.type !== "expense") continue;
    if (!t.date.startsWith(month) || t.date > todayIso) continue;
    const amount = Math.abs(t.amount || 0);
    if (!amount) continue;
    const cat = t.categoryId ? byId.get(t.categoryId) : undefined;
    if (!cat) {
      const g = groupFor(null, "Sem categoria");
      g.total = round(g.total + amount);
      continue;
    }
    const parent = cat.parentId ? byId.get(cat.parentId) : undefined;
    const root = parent ?? cat;
    const g = groupFor(root.id!, root.name);
    g.total = round(g.total + amount);
    if (parent) {
      let s = g.subs.find((x) => x.id === cat.id);
      if (!s) {
        s = { id: cat.id!, name: cat.name, total: 0 };
        g.subs.push(s);
      }
      s.total = round(s.total + amount);
    }
  }

  const out = [...groups.values()];
  for (const g of out) g.subs.sort((a, b) => b.total - a.total);
  out.sort((a, b) => {
    if (a.id === null) return 1;
    if (b.id === null) return -1;
    return b.total - a.total || a.name.localeCompare(b.name, "pt-BR");
  });
  const total = round(out.reduce((s, g) => s + g.total, 0));

  // Categorias de despesa (raiz) que não tiveram gasto no mês.
  const used = new Set(out.map((g) => g.id));
  const idle = categories
    .filter((c) => c.kind === "expense" && !c.parentId && !used.has(c.id!))
    .map((c) => c.name)
    .sort((a, b) => a.localeCompare(b, "pt-BR"));

  return { month, groups: out, total, idle };
}

/** Mensagens HTML prontas para o Telegram, divididas no limite. */
export function buildExpensesMessages(
  transactions: Transaction[],
  categories: Category[],
  todayIso: string,
): string[] {
  const { groups, total, idle } = spendByCategory(transactions, categories, todayIso);
  const [y, m, d] = todayIso.split("-");
  const header =
    `<b>📊 Gastos por categoria — ${MONTHS[Number(m) - 1]}/${y}</b> (até ${d}/${m})\n` +
    `Total gasto no mês: <b>${brl(total)}</b>`;

  const messages: string[] = [];
  let current = header;
  const push = (chunk: string) => {
    if (current.length + chunk.length + 2 > MAX_MESSAGE) {
      messages.push(current);
      current = "";
    }
    current += (current ? "\n\n" : "") + chunk;
  };

  if (groups.length === 0) {
    push("Nenhuma despesa lançada neste mês até agora.");
  }
  for (const g of groups) {
    const pct = total > 0 ? Math.round((g.total / total) * 100) : 0;
    let block = `🏷 <b>${escapeHtml(g.name)}</b> — <b>${brl(g.total)}</b> (${pct}%)`;
    for (const s of g.subs) block += `\n   ↳ ${escapeHtml(s.name)} — ${brl(s.total)}`;
    push(block);
  }
  if (idle.length > 0) {
    push(`<i>Sem gasto no mês:</i> ${idle.map(escapeHtml).join(", ")}`);
  }
  if (current) messages.push(current);
  return messages;
}
