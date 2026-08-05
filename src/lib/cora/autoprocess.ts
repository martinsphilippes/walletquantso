// WalletQuantso — automatic routing of Cora bank movements (pure logic).
//
// For each bank movement, decides its destination in the Wallet:
//
//   • skip    — a lançamento with this bank id (externalId) already exists.
//   • merge   — the movement exists twice: the original (Meu Dinheiro, richer
//     classification) AND a copy imported from Cora. The original is preserved
//     and stamped with the bank id; the Cora copy is removed.
//   • link    — an existing lançamento (same date, value and direction, not yet
//     linked to the bank) is adopted as the bank movement: stamped with the
//     bank id and marked reconciled. Nothing is created.
//   • settleBill — a DEBIT with a name similar to an open payable: the título
//     keeps its name/classification, assumes the bank value and is settled.
//   • create  — no counterpart anywhere: a new lançamento is created.
//
// All routed lançamentos end up reconciled (the bank statement is the source).

import type { Bill, Transaction } from "@/types";
import type { NormalizedEntry } from "./statement";
import { signedForAccount } from "./reconcile";
import { remaining } from "@/lib/bills/status";

// Generic banking words that carry no identity for name matching.
const STOPWORDS = new Set([
  "pix", "ted", "doc", "boleto", "pagamento", "pagto", "transferencia",
  "transf", "recebimento", "envio", "enviado", "recebido", "para", "cora",
  "banco", "conta", "ltda", "eireli", "comercio", "servico", "servicos",
]);

/** Significant name tokens: lowercase, no accents, length >= 3, no stopwords. */
export function nameTokens(s: string): Set<string> {
  const norm = s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  return new Set(
    norm.split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
  );
}

/**
 * Flexible name similarity: true when the two names share at least two
 * significant tokens, or a single longer one (>= 5 chars, e.g. a company name).
 */
export function namesMatch(a: string, b: string): boolean {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  let shared = 0;
  let hasLong = false;
  for (const t of ta) {
    if (tb.has(t)) {
      shared++;
      if (t.length >= 5) hasLong = true;
    }
  }
  return shared >= 2 || (shared === 1 && hasLong);
}

export type AutoAction =
  | { kind: "skip"; entry: NormalizedEntry }
  | { kind: "merge"; entry: NormalizedEntry; keep: Transaction; removeId: string }
  | { kind: "link"; entry: NormalizedEntry; keep: Transaction }
  /** Linked lançamento sits on the wrong account — move it to the right one. */
  | { kind: "move"; entry: NormalizedEntry; keep: Transaction }
  | { kind: "settleBill"; entry: NormalizedEntry; bill: Bill }
  | { kind: "create"; entry: NormalizedEntry };

const dayMs = 86400000;
const dateDist = (a: string, b: string) =>
  Math.abs(Date.parse(a) - Date.parse(b)) / dayMs;

/** Best open payable whose name resembles the movement description. */
function bestBillMatch(
  entry: NormalizedEntry,
  payables: Bill[],
  consumed: Set<string>,
): Bill | null {
  const candidates = payables.filter(
    (b) =>
      b.id &&
      !consumed.has(b.id) &&
      remaining(b) > 0 &&
      namesMatch(entry.description, b.description),
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const d = dateDist(a.dueDate, entry.date) - dateDist(b.dueDate, entry.date);
    if (d !== 0) return d;
    return (
      Math.abs(a.amount - entry.amount) - Math.abs(b.amount - entry.amount)
    );
  });
  return candidates[0];
}

/** Decide the destination of every bank movement. Pure; nothing is written. */
export function planAutoProcess(
  entries: NormalizedEntry[],
  txs: Transaction[],
  payables: Bill[],
  accountId: string,
): AutoAction[] {
  // Existing lançamentos already linked to a bank id.
  const byExternal = new Map<string, Transaction>();
  for (const t of txs) if (t.externalId) byExternal.set(t.externalId, t);

  // Unlinked lançamentos touching this account, grouped by (date|amount|dir).
  const twins = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (t.externalId) continue;
    const signed = signedForAccount(t, accountId);
    if (signed === 0) continue;
    const key = `${t.date}|${Math.abs(signed)}|${signed > 0 ? "C" : "D"}`;
    const list = twins.get(key) ?? [];
    list.push(t);
    twins.set(key, list);
  }
  const popTwin = (key: string): Transaction | null => {
    const list = twins.get(key);
    return list && list.length > 0 ? (list.shift() as Transaction) : null;
  };

  const consumedBills = new Set<string>();
  const actions: AutoAction[] = [];

  // Oldest first for deterministic matching.
  const ordered = [...entries].sort((a, b) => (a.date < b.date ? -1 : 1));

  for (const entry of ordered) {
    const key = `${entry.date}|${entry.amount}|${entry.type === "income" ? "C" : "D"}`;
    const linked = byExternal.get(entry.externalId) ?? null;
    const twin = popTwin(key);

    if (linked && twin) {
      // Duplicate pair: preserve the original (Meu Dinheiro), drop the copy.
      actions.push({ kind: "merge", entry, keep: twin, removeId: linked.id! });
    } else if (linked) {
      if (signedForAccount(linked, accountId) === 0) {
        // Linked, but on the wrong account (e.g. imported with another account
        // selected). Move it to the account this statement belongs to.
        actions.push({ kind: "move", entry, keep: linked });
      } else {
        actions.push({ kind: "skip", entry });
      }
    } else if (twin) {
      actions.push({ kind: "link", entry, keep: twin });
    } else if (entry.type === "expense") {
      const bill = bestBillMatch(entry, payables, consumedBills);
      if (bill?.id) {
        consumedBills.add(bill.id);
        actions.push({ kind: "settleBill", entry, bill });
      } else {
        actions.push({ kind: "create", entry });
      }
    } else {
      actions.push({ kind: "create", entry });
    }
  }

  return actions;
}
