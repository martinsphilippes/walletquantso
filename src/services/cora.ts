// WalletQuantso — Cora sync (client side).
//
// Calls the server route (which holds the mTLS certificate) to fetch the
// statement, then saves the movements as lançamentos, skipping any that were
// already imported (dedup by the Cora entry id stored in `externalId`).

import { addDoc, collection } from "firebase/firestore";
import { db } from "./firebase";
import { COLLECTIONS, listTransactions } from "./firestore";
import { dedupHash } from "@/lib/import/engine";
import type { Transaction } from "@/types";
import type { NormalizedEntry } from "@/lib/cora/statement";

/** Fetch the normalized Cora statement for a date range via the server route. */
export async function fetchCoraStatement(
  idToken: string,
  start: string,
  end: string,
): Promise<NormalizedEntry[]> {
  const res = await fetch("/api/cora/statement", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ start, end }),
  });
  const json = (await res.json().catch(() => ({}))) as { entries?: NormalizedEntry[]; error?: string };
  if (!res.ok) throw new Error(json.error || `Falha na sincronização (HTTP ${res.status}).`);
  return json.entries ?? [];
}

export interface CoraSyncResult {
  created: number;
  skipped: number;
}

/**
 * Save Cora movements as lançamentos on the chosen account, skipping ones whose
 * `externalId` already exists (so re-syncing an overlapping period is safe).
 */
export async function commitCoraEntries(
  ownerId: string,
  accountId: string,
  entries: NormalizedEntry[],
): Promise<CoraSyncResult> {
  const existing = await listTransactions(ownerId);
  const seen = new Set(
    existing.map((t) => t.externalId).filter((x): x is string => !!x),
  );

  let created = 0;
  let skipped = 0;
  const now = Date.now();
  for (const e of entries) {
    if (seen.has(e.externalId)) {
      skipped++;
      continue;
    }
    const record: Transaction = {
      ownerId,
      date: e.date,
      amount: e.amount,
      type: e.type,
      description: e.description,
      accountId,
      categoryId: null,
      transferAccountId: null,
      costCenterId: null,
      contactId: null,
      installment: null,
      installmentGroupId: null,
      importBatchId: null,
      externalId: e.externalId,
      dedupHash: dedupHash({
        date: e.date,
        amount: e.amount,
        description: e.description,
        account: accountId,
      }),
      createdAt: now,
    };
    await addDoc(collection(db, COLLECTIONS.transactions), record);
    seen.add(e.externalId);
    created++;
  }
  return { created, skipped };
}
