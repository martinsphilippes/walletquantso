// WalletQuantso — relatório "Contas a pagar por conta" para o Telegram
// (lógica pura, sem I/O).
//
// Agrupa os títulos a pagar em aberto pela conta financeira de cada um,
// ordena por vencimento e monta mensagens em HTML do Telegram, já divididas
// para caber no limite de 4096 caracteres por mensagem.

import type { Account, Bill } from "@/types";
import { remaining } from "@/lib/bills/status";

/** Limite do Telegram é 4096; folga para o rodapé e escapes. */
const MAX_MESSAGE = 3800;

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const brDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Escapa o que o modo HTML do Telegram interpretaria. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface PayablesGroup {
  accountId: string | null;
  accountName: string;
  total: number;
  overdue: number;
  bills: Array<{ dueDate: string; description: string; open: number; status: "overdue" | "today" | "future" }>;
}

/** Títulos a pagar em aberto agrupados por conta, ordenados por vencimento. */
export function groupPayablesByAccount(
  bills: Bill[],
  accounts: Account[],
  todayIso: string,
): PayablesGroup[] {
  const accName = new Map(accounts.map((a) => [a.id!, a.name]));
  const groups = new Map<string, PayablesGroup>();
  for (const b of bills) {
    if (b.kind !== "payable") continue;
    const open = remaining(b);
    if (open <= 0) continue;
    const key = b.accountId ?? "";
    let g = groups.get(key);
    if (!g) {
      g = {
        accountId: b.accountId ?? null,
        accountName: b.accountId ? (accName.get(b.accountId) ?? "Conta removida") : "Sem conta definida",
        total: 0,
        overdue: 0,
        bills: [],
      };
      groups.set(key, g);
    }
    const status = b.dueDate < todayIso ? "overdue" : b.dueDate === todayIso ? "today" : "future";
    g.bills.push({ dueDate: b.dueDate, description: b.description, open, status });
    g.total = round(g.total + open);
    if (status === "overdue") g.overdue = round(g.overdue + open);
  }
  const out = [...groups.values()];
  for (const g of out) g.bills.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
  // Contas com nome em ordem alfabética; "Sem conta" por último.
  out.sort((a, b) => {
    if (!a.accountId) return 1;
    if (!b.accountId) return -1;
    return a.accountName.localeCompare(b.accountName, "pt-BR");
  });
  return out;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

const STATUS_ICON = { overdue: "🔴", today: "🟡", future: "⚪" } as const;

/**
 * Mensagens prontas para enviar (HTML do Telegram). A primeira traz o
 * cabeçalho e o total geral; cada conta começa com o próprio subtotal.
 * Contas grandes são divididas em continuações.
 */
export function buildPayablesMessages(
  bills: Bill[],
  accounts: Account[],
  todayIso: string,
): string[] {
  const groups = groupPayablesByAccount(bills, accounts, todayIso);
  const total = round(groups.reduce((s, g) => s + g.total, 0));
  const overdue = round(groups.reduce((s, g) => s + g.overdue, 0));
  const count = groups.reduce((s, g) => s + g.bills.length, 0);

  const header =
    `<b>📋 Contas a pagar — ${brDate(todayIso)}/${todayIso.slice(0, 4)}</b>\n` +
    `${count} título(s) em aberto · total <b>${brl(total)}</b>` +
    (overdue > 0 ? `\n🔴 Atrasado: <b>${brl(overdue)}</b>` : "");

  if (count === 0) {
    return [`${header}\n\nNenhum título em aberto. 🎉`];
  }

  const messages: string[] = [];
  let current = header;

  const push = (chunk: string) => {
    if (current.length + chunk.length + 2 > MAX_MESSAGE) {
      messages.push(current);
      current = "";
    }
    current += (current ? "\n\n" : "") + chunk;
  };

  for (const g of groups) {
    const title =
      `<b>🏦 ${escapeHtml(g.accountName)}</b> — ${g.bills.length} título(s) · <b>${brl(g.total)}</b>` +
      (g.overdue > 0 ? ` · 🔴 ${brl(g.overdue)}` : "");
    let block = title;
    for (const b of g.bills) {
      const line = `${STATUS_ICON[b.status]} ${brDate(b.dueDate)} · ${escapeHtml(b.description)} · ${brl(b.open)}`;
      if (block.length + line.length + 1 > MAX_MESSAGE) {
        push(block);
        block = `<b>🏦 ${escapeHtml(g.accountName)}</b> (continuação)`;
      }
      block += `\n${line}`;
    }
    push(block);
  }
  push("🔴 atrasado · 🟡 vence hoje · ⚪ a vencer");
  if (current) messages.push(current);
  return messages;
}
