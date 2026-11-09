// WalletQuantso — abater num título lançamentos que JÁ existem (lógica pura).
//
// Situação típica: o título "Qpaozinho — Mensal" foi gerado no começo do mês,
// mas parte desse dinheiro já tinha entrado ao longo do mês anterior, em
// vários lançamentos. Dar baixa normal criaria lançamentos novos e contaria o
// dinheiro duas vezes. Aqui o usuário escolhe os lançamentos existentes e cada
// um vira uma baixa do título que APONTA para ele (transactionId, linked): o
// caixa continua contado uma vez só — pelo lançamento — e o saldo do título
// cai. Desfazer a baixa só desliga o lançamento (ele continua em Lançamentos).

import type { Bill, BillPayment, Transaction } from "@/types";
import { remaining } from "./status";

const round2 = (n: number) => Math.round(n * 100) / 100;
const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Palavra-chave do título para sugerir lançamentos: o trecho antes do
 * primeiro " — " / " - " ("Qpaozinho — Mensal — 12% de …" → "qpaozinho").
 * Vazia quando curta demais para ser útil.
 */
export function billNameKey(description: string): string {
  const head = (description ?? "").split(/\s[—–-]\s/)[0] ?? "";
  const key = norm(head).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  return key.length >= 3 ? key : "";
}

export interface LinkFilter {
  /** Datas ISO (YYYY-MM-DD), inclusivas; vazias = sem limite. */
  from?: string;
  to?: string;
  accountId?: string;
  /** Busca na descrição, nas observações ou no valor ("1.500"). */
  query?: string;
}

export interface LinkCandidate {
  tx: Transaction;
  /** Mesmo contato, mesma categoria ou o nome do título na descrição. */
  suggested: boolean;
}

/**
 * Lançamentos que podem ser abatidos no título: do tipo certo (receita para
 * conta a receber, despesa para conta a pagar), com valor, que ainda não são
 * baixa de nenhum título existente (`bills`) e que não são taxa nem gasto
 * vinculado (ex.: Taxa Depix, L-BTC). Sugeridos primeiro; dentro de cada
 * grupo, do mais recente para o mais antigo.
 */
export function linkCandidates(
  bill: Bill,
  txs: Transaction[],
  bills: Bill[],
  filter: LinkFilter = {},
): LinkCandidate[] {
  const want = bill.kind === "receivable" ? "income" : "expense";
  const billIds = new Set(bills.map((b) => b.id).filter((x): x is string => !!x));
  // Já é baixa de algum título (pelo lado do título — vale mesmo se a marca
  // no lançamento tiver se perdido numa edição antiga).
  const taken = new Set<string>();
  for (const b of bills) for (const p of b.payments ?? []) if (p.transactionId) taken.add(p.transactionId);
  if (bill.id) billIds.add(bill.id);
  for (const p of bill.payments ?? []) if (p.transactionId) taken.add(p.transactionId);

  const key = billNameKey(bill.description);
  const q = norm(filter.query ?? "").trim();
  const out: LinkCandidate[] = [];
  for (const t of txs) {
    if (!t.id || t.type !== want || t.feeOfId || !(t.amount > 0)) continue;
    if (taken.has(t.id)) continue;
    if (t.billId && billIds.has(t.billId)) continue;
    if (filter.from && t.date < filter.from) continue;
    if (filter.to && t.date > filter.to) continue;
    if (filter.accountId && t.accountId !== filter.accountId) continue;
    const desc = norm(t.description ?? "");
    if (q) {
      const money = t.amount.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const hay = `${desc} ${norm(t.notes ?? "")} ${money} ${money.replace(/\./g, "")}`;
      if (!hay.includes(q)) continue;
    }
    const suggested =
      (!!bill.contactId && t.contactId === bill.contactId) ||
      (!!bill.categoryId && t.categoryId === bill.categoryId) ||
      (!!key && desc.includes(key));
    out.push({ tx: t, suggested });
  }
  return out.sort((a, b) =>
    a.suggested !== b.suggested ? (a.suggested ? -1 : 1) : b.tx.date.localeCompare(a.tx.date),
  );
}

/** Uma baixa por lançamento escolhido, apontando para ele. */
export function linkedPaymentsFor(txs: Transaction[], newId: () => string): BillPayment[] {
  return txs
    .filter((t) => !!t.id)
    .map((t) => ({
      id: newId(),
      date: t.date,
      amount: round2(t.amount),
      accountId: t.accountId || null,
      transactionId: t.id!,
      linked: true,
    }));
}

export interface LinkSummary {
  count: number;
  /** Soma dos lançamentos escolhidos. */
  total: number;
  remainingBefore: number;
  /** Saldo do título depois de abater (nunca negativo). */
  remainingAfter: number;
  /** Quanto os escolhidos passam do saldo (não vira crédito). */
  excess: number;
}

export function linkSummary(bill: Bill, txs: Transaction[]): LinkSummary {
  const total = round2(txs.reduce((s, t) => s + (t.amount || 0), 0));
  const before = remaining(bill);
  return {
    count: txs.length,
    total,
    remainingBefore: before,
    remainingAfter: round2(Math.max(0, before - total)),
    excess: round2(Math.max(0, total - before)),
  };
}

/**
 * Classificação do título levada para os campos VAZIOS do lançamento
 * (categoria, centro de custo, contato) — o que já estiver preenchido fica.
 */
export function classifyPatch(
  t: Transaction,
  bill: Bill,
): Partial<Pick<Transaction, "categoryId" | "costCenterId" | "contactId">> {
  const patch: Partial<Pick<Transaction, "categoryId" | "costCenterId" | "contactId">> = {};
  if (!t.categoryId && bill.categoryId) patch.categoryId = bill.categoryId;
  if (!t.costCenterId && bill.costCenterId) patch.costCenterId = bill.costCenterId;
  if (!t.contactId && bill.contactId) patch.contactId = bill.contactId;
  return patch;
}

/**
 * Período sugerido para procurar os lançamentos: do 1º dia do mês anterior
 * ao do título (competência ou vencimento, o que vier antes) até o
 * vencimento — ou até hoje, se o vencimento já passou.
 */
export function defaultLinkPeriod(bill: Bill, today: string): { from: string; to: string } {
  const comp = bill.competenceDate || bill.dueDate;
  const ref = comp < bill.dueDate ? comp : bill.dueDate;
  const [y, m] = ref.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 2, 1));
  const from = `${prev.getUTCFullYear()}-${pad2(prev.getUTCMonth() + 1)}-01`;
  const to = bill.dueDate > today ? bill.dueDate : today;
  return { from, to };
}
