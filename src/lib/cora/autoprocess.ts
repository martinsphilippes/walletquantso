// WalletQuantso — automatic routing of Cora bank movements (pure logic).
//
// For each bank movement, decides its destination in the Wallet:
//
//   • skip    — a lançamento with this bank id (externalId) already exists.
//   • merge   — the movement exists twice: the original (Meu Dinheiro, richer
//     classification) AND a copy imported from Cora. The original is preserved
//     and stamped with the bank id; the Cora copy is removed.
//   • link    — an existing lançamento (same date, value, direction AND a
//     similar name, not yet linked to the bank) is adopted as the bank
//     movement: stamped with the bank id. Nothing is created.
//   • settleBill — a DEBIT with a name similar to an open payable: the título
//     keeps its name/classification, assumes the bank value and is settled.
//   • create  — no counterpart anywhere: a new lançamento is created.
//
// Identity matters: value+date alone never identify a counterpart — two
// different PIX of the same amount on the same day would cross-match. Every
// adoption/settlement therefore also requires name similarity (namesMatch).
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
 * Name similarity for identifying a counterpart. Rule: at least TWO shared
 * significant tokens (nome + sobrenome) — "Gabriel Domingues" must NOT match
 * "Gabriel Chaves". The only exception is when one of the sides has a single
 * significant token (e.g. a company like "CEMIG"): then that token must be
 * shared and reasonably long (>= 5 chars).
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
  if (shared >= 2) return true;
  // Single-token side (company-style name): its one token must match, and be
  // long enough to carry identity.
  const minSide = Math.min(ta.size, tb.size);
  return minSide === 1 && shared === 1 && hasLong;
}

export type AutoAction =
  | { kind: "skip"; entry: NormalizedEntry }
  | { kind: "merge"; entry: NormalizedEntry; keep: Transaction; removeId: string }
  | { kind: "link"; entry: NormalizedEntry; keep: Transaction }
  /** Linked lançamento has the wrong account and/or date — fix it in place. */
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
  // Adoption requires identity: same (date|amount|dir) AND similar name.
  // Value+date alone would cross-match unrelated movements of the same amount.
  const popTwin = (key: string, entryDescription: string): Transaction | null => {
    const list = twins.get(key);
    if (!list || list.length === 0) return null;
    const i = list.findIndex((t) => namesMatch(entryDescription, t.description ?? ""));
    if (i < 0) return null;
    return list.splice(i, 1)[0];
  };

  const consumedBills = new Set<string>();
  const actions: AutoAction[] = [];

  // Oldest first for deterministic matching.
  const ordered = [...entries].sort((a, b) => (a.date < b.date ? -1 : 1));

  for (const entry of ordered) {
    const key = `${entry.date}|${entry.amount}|${entry.type === "income" ? "C" : "D"}`;
    const linked = byExternal.get(entry.externalId) ?? null;
    const twin = popTwin(key, entry.description);

    if (linked && twin) {
      // Duplicate pair: preserve the original (Meu Dinheiro), drop the copy.
      actions.push({ kind: "merge", entry, keep: twin, removeId: linked.id! });
    } else if (linked) {
      if (signedForAccount(linked, accountId) === 0 || linked.date !== entry.date) {
        // Linked, but with the wrong account (imported with another account
        // selected) and/or the wrong date (old UTC-shifted imports). Fix it.
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
