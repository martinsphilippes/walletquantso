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

/**
 * Date (YYYY-MM-DD) of a Cora timestamp in Brazil's timezone. Cora returns
 * UTC timestamps with a short offset ("2026-07-29T01:30:00+00") that
 * JavaScript's Date cannot parse, and taking the date straight from the string
 * shifts any night-time movement to the next day — so we normalize the offset
 * and convert to America/Sao_Paulo before extracting the day.
 */
export function brDateOf(isoTimestamp: string): string {
  let s = (isoTimestamp || "").trim();
  // Normalize short offsets: "+0000" → "+00:00", then "+00" → "+00:00".
  s = s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2").replace(/([+-]\d{2})$/, "$1:00");
  // No timezone info at all → per the API docs, timestamps are UTC.
  if (!/([zZ]|[+-]\d{2}:\d{2})$/.test(s)) s += "Z";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return (isoTimestamp || "").slice(0, 10);
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

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
      date: brDateOf(entry.createdAt || ""),
      amount,
      type: entry.type === "CREDIT" ? "income" : "expense",
      description: describeEntry(entry),
    });
  }
  return out;
}
