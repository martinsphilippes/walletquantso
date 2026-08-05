// WalletQuantso — Cora bank statement mapping (pure logic).
//
// Converts entries from the Cora "consulta de extrato" API into normalized
// movements the app can turn into lançamentos. Kept free of I/O so it is fully
// unit-testable; the network/mTLS part lives in src/server/cora.ts.
//
// Cora entry shape (relevant fields):
//   { id, type: "CREDIT"|"DEBIT"|"BLOCK"|"UNBLOCK", amount (cents),
//     createdAt (ISO), transaction?: { id, type, description,
//     counterParty?: { name, identity } } }

export interface CoraCounterParty {
  name?: string | null;
  identity?: string | null;
}

export interface CoraTransaction {
  id?: string;
  type?: string;
  description?: string | null;
  counterParty?: CoraCounterParty | null;
}

export interface CoraEntry {
  id: string;
  type: "CREDIT" | "DEBIT" | "BLOCK" | "UNBLOCK" | string;
  /** Value in cents (integer, always positive). */
  amount: number;
  /** ISO timestamp, e.g. "2023-04-06T09:00:00+00". */
  createdAt: string;
  transaction?: CoraTransaction | null;
}

export interface CoraStatementResponse {
  entries?: CoraEntry[];
  /** Balance snapshots (in cents) at the start/end of the queried period. */
  start?: { date?: string; balance?: number } | null;
  end?: { date?: string; balance?: number } | null;
  [key: string]: unknown;
}

/** A movement ready to become a lançamento (account is assigned on save). */
export interface NormalizedEntry {
  /** Stable external id, e.g. "cora:ent_AilRQ...". Used for dedup. */
  externalId: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** Positive amount in BRL. */
  amount: number;
  /** CREDIT → income, DEBIT → expense. */
  type: "income" | "expense";
  description: string;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Best-effort human description from a Cora entry. */
export function describeEntry(entry: CoraEntry): string {
  const t = entry.transaction;
  const desc = t?.description?.trim();
  const party = t?.counterParty?.name?.trim();
  if (desc && party && !desc.includes(party)) return `${desc} — ${party}`;
  return desc || party || t?.type || "Movimentação Cora";
}

/**
 * Normalize a Cora statement response into income/expense movements. Only
 * CREDIT and DEBIT entries become lançamentos; BLOCK/UNBLOCK (holds) are
 * ignored. Entries with a non-positive amount are skipped.
 */
export function normalizeCoraStatement(res: CoraStatementResponse): NormalizedEntry[] {
  const out: NormalizedEntry[] = [];
  for (const entry of res.entries ?? []) {
    if (entry.type !== "CREDIT" && entry.type !== "DEBIT") continue;
    const amount = round((entry.amount || 0) / 100);
    if (amount <= 0) continue;
    out.push({
      externalId: `cora:${entry.id}`,
      date: (entry.createdAt || "").slice(0, 10),
      amount,
      type: entry.type === "CREDIT" ? "income" : "expense",
      description: describeEntry(entry),
    });
  }
  return out;
}
