// WalletQuantso — "/pagar <data>" e "/receber <data>" para o Telegram
// (lógica pura, sem I/O).
//
// Interpreta a data pedida em português (hoje, amanhã, 25, 25/09, sexta,
// 21/09 a 25/09…) e lista os títulos em aberto que vencem naquele dia (ou
// intervalo), organizados por centro de custo com subtotal, total geral e
// os atrasados anteriores à data.

import type { Account, Bill, Category, Contact, CostCenter } from "@/types";
import { remaining } from "@/lib/bills/status";
import { escapeHtml } from "./payables-telegram";

const MAX_MESSAGE = 3800;
const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const round = (n: number) => Math.round(n * 100) / 100;
const brDate = (iso: string) => iso.split("-").reverse().join("/");
const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

const normalize = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function validIso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > last) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Uma data isolada: hoje, amanhã, ontem, dia, dd/mm, dd/mm/aaaa ou dia da semana. */
export function parseOneDate(text: string, todayIso: string): string | null {
  const t = normalize(text);
  const [ty, tm] = todayIso.split("-").map(Number);
  if (!t || t === "hoje") return todayIso;
  if (t === "amanha") return addDays(todayIso, 1);
  if (t === "ontem") return addDays(todayIso, -1);
  if (t === "depois de amanha") return addDays(todayIso, 2);

  const wd = WEEKDAYS.findIndex((w) => normalize(w).startsWith(t.replace(/-?feira$/, "").trim()) && t.length >= 3);
  if (wd >= 0) {
    const [y, m, d] = todayIso.split("-").map(Number);
    const base = new Date(Date.UTC(y, m - 1, d));
    const diff = (wd - base.getUTCDay() + 7) % 7;
    return addDays(todayIso, diff);
  }

  const full = /^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2}|\d{4}))?$/.exec(t);
  if (full) {
    const d = Number(full[1]);
    const m = Number(full[2]);
    let y = full[3] ? Number(full[3]) : ty;
    if (full[3] && full[3].length === 2) y += 2000;
    return validIso(y, m, d);
  }
  const dayOnly = /^(\d{1,2})$/.exec(t);
  if (dayOnly) return validIso(ty, tm, Number(dayOnly[1]));
  return null;
}

export interface DateRange {
  start: string;
  end: string;
}

/** Data ou intervalo ("21/09 a 25/09", "hoje até sexta", "21/09 - 25/09"). */
export function parseDateArg(text: string, todayIso: string): DateRange | null {
  const t = text.trim();
  const parts = t.split(/\s+(?:a|ate|até|-)\s+|\s*-\s*(?=\d{1,2}[\/.]\d)/i);
  if (parts.length === 2) {
    const start = parseOneDate(parts[0], todayIso);
    const end = parseOneDate(parts[1], todayIso);
    if (!start || !end) return null;
    return start <= end ? { start, end } : { start: end, end: start };
  }
  const one = parseOneDate(t, todayIso);
  return one ? { start: one, end: one } : null;
}

export function describeRange(r: DateRange, todayIso: string): string {
  const label = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
    const tag = iso === todayIso ? " (hoje)" : iso === addDays(todayIso, 1) ? " (amanhã)" : "";
    return `${wd}, ${brDate(iso)}${tag}`;
  };
  return r.start === r.end ? label(r.start) : `${brDate(r.start)} a ${brDate(r.end)}`;
}

export const HELP_DATES =
  "Datas aceitas: <code>hoje</code>, <code>amanhã</code>, <code>25</code>, <code>25/09</code>, <code>25/09/2026</code>, " +
  "<code>sexta</code>, ou um intervalo como <code>21/09 a 25/09</code>.";

/** Centro de custo de um título: o dele, ou o herdado da categoria (ou da mãe). */
function costCenterOfBill(b: Bill, byCat: Map<string, Category>): string | null {
  if (b.costCenterId) return b.costCenterId;
  const cat = b.categoryId ? byCat.get(b.categoryId) : undefined;
  if (!cat) return null;
  if (cat.costCenterId) return cat.costCenterId;
  const parent = cat.parentId ? byCat.get(cat.parentId) : undefined;
  return parent?.costCenterId ?? null;
}

/**
 * Títulos em aberto de um tipo (a pagar / a receber) vencendo no intervalo,
 * organizados por centro de custo: total geral no topo e, em cada centro,
 * o subtotal e os títulos (descrição, contato, conta e valor).
 */
export function buildDayBillsMessages(
  kind: "payable" | "receivable",
  bills: Bill[],
  accounts: Account[],
  contacts: Contact[],
  categories: Category[],
  costCenters: CostCenter[],
  range: DateRange,
  todayIso: string,
): string[] {
  const accName = new Map(accounts.map((a) => [a.id!, a.name]));
  const contactName = new Map(contacts.map((c) => [c.id!, c.name]));
  const ccName = new Map(costCenters.map((c) => [c.id!, c.name]));
  const byCat = new Map(categories.map((c) => [c.id!, c]));
  const isPay = kind === "payable";
  const title = isPay ? "Contas a pagar" : "Contas a receber";
  const icon = isPay ? "📤" : "📥";

  const open = bills.filter((b) => b.kind === kind && remaining(b) > 0);
  const inRange = open
    .filter((b) => b.dueDate >= range.start && b.dueDate <= range.end)
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.description.localeCompare(b.description, "pt-BR")));
  const overdue = round(open.filter((b) => b.dueDate < range.start).reduce((s, b) => s + remaining(b), 0));
  const total = round(inRange.reduce((s, b) => s + remaining(b), 0));

  const groups = new Map<string, { name: string; total: number; bills: Bill[] }>();
  for (const b of inRange) {
    const ccId = costCenterOfBill(b, byCat);
    const key = ccId ?? "";
    const name = ccId ? (ccName.get(ccId) ?? "Centro removido") : "Sem centro de custo";
    const g = groups.get(key) ?? { name, total: 0, bills: [] };
    g.total = round(g.total + remaining(b));
    g.bills.push(b);
    groups.set(key, g);
  }
  // Maior subtotal primeiro; "Sem centro de custo" por último.
  const ordered = [...groups.entries()]
    .sort(([ka, a], [kb, b]) => (ka === "" ? 1 : kb === "" ? -1 : b.total - a.total || a.name.localeCompare(b.name, "pt-BR")))
    .map(([, g]) => g);

  const multi = range.start !== range.end;
  const header =
    `<b>${icon} ${title} — ${describeRange(range, todayIso)}</b>\n` +
    `Total: <b>${brl(total)}</b> · ${inRange.length} título(s) · ${ordered.length} centro(s)` +
    (overdue > 0 ? `\n🔴 Atrasados antes desta data: ${brl(overdue)}` : "");

  const messages: string[] = [];
  let current = header;
  const push = (chunk: string) => {
    if (current.length + chunk.length + 2 > MAX_MESSAGE) {
      messages.push(current);
      current = "";
    }
    current += (current ? "\n\n" : "") + chunk;
  };

  if (inRange.length === 0) {
    push(`Nenhum título ${isPay ? "a pagar" : "a receber"} ${multi ? "neste período" : "neste dia"}. 🎉`);
  }
  for (const g of ordered) {
    const pct = total > 0 ? Math.round((g.total / total) * 100) : 0;
    let block = `<b>🏢 ${escapeHtml(g.name)} — ${brl(g.total)}</b> (${pct}%)`;
    for (const b of g.bills) {
      const who = b.contactId ? contactName.get(b.contactId) : "";
      const acc = b.accountId ? accName.get(b.accountId) : "";
      const extras = [who, acc].filter(Boolean).map((x) => escapeHtml(x!)).join(" · ");
      const day = multi ? `${brDate(b.dueDate).slice(0, 5)} · ` : "";
      const line = `• ${day}${escapeHtml(b.description)} — <b>${brl(remaining(b))}</b>${extras ? ` <i>(${extras})</i>` : ""}`;
      if (block.length + line.length + 1 > MAX_MESSAGE) {
        push(block);
        block = `<b>🏢 ${escapeHtml(g.name)}</b> (continuação)`;
      }
      block += `\n${line}`;
    }
    push(block);
  }
  if (current) messages.push(current);
  return messages;
}
