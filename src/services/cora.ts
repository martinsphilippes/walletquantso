// WalletQuantso — Cora sync (client side).
//
// Calls the server route (which holds the mTLS certificate) to fetch the
// statement, then saves the movements as lançamentos, skipping any that were
// already imported (dedup by the Cora entry id stored in `externalId`).

import { addDoc, collection, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "./firebase";
import { COLLECTIONS, listTransactions } from "./firestore";
import { listBills, addPayment } from "./bills";
import { removeTransaction } from "./transactions";
import { dedupHash } from "@/lib/import/engine";
import { planAutoProcess } from "@/lib/cora/autoprocess";
import type { CoraSyncConfig, Transaction } from "@/types";
import type { NormalizedEntry } from "@/lib/cora/statement";

const rid = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** Read the owner's Cora auto-sync config (null when never configured). */
export async function getCoraSyncConfig(uid: string): Promise<CoraSyncConfig | null> {
  const snap = await getDoc(doc(db, "coraSync", uid));
  return snap.exists() ? (snap.data() as CoraSyncConfig) : null;
}

/** Enable/disable the scheduled auto-sync and set the destination account. */
export async function setCoraSyncConfig(
  uid: string,
  patch: { enabled: boolean; accountId: string },
): Promise<void> {
  await setDoc(
    doc(db, "coraSync", uid),
    {
      ownerId: uid,
      enabled: patch.enabled,
      accountId: patch.accountId,
      updatedAt: Date.now(),
    },
    { merge: true },
  );
}

export interface CoraStatementData {
  entries: NormalizedEntry[];
  /** Real bank balance (BRL) at the start/end of the period, when provided. */
  startBalance: number | null;
  endBalance: number | null;
}

/** Fetch the normalized Cora statement for a date range via the server route. */
export async function fetchCoraStatement(
  idToken: string,
  start: string,
  end: string,
): Promise<CoraStatementData> {
  const res = await fetch("/api/cora/statement", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ start, end }),
  });
  const json = (await res.json().catch(() => ({}))) as Partial<CoraStatementData> & {
    error?: string;
  };
  if (!res.ok) throw new Error(json.error || `Falha na sincronização (HTTP ${res.status}).`);
  return {
    entries: json.entries ?? [],
    startBalance: json.startBalance ?? null,
    endBalance: json.endBalance ?? null,
  };
}

export interface CoraSyncResult {
  created: number;
  skipped: number;
}

export interface AutoProcessResult {
  /** New lançamentos created. */
  created: number;
  /** Duplicate pairs resolved (Meu Dinheiro preserved, Cora copy removed). */
  merged: number;
  /** Existing lançamentos adopted (stamped with the bank id). */
  linked: number;
  /** Linked lançamentos moved from the wrong account to this one. */
  moved: number;
  /** Payables settled at the bank value. */
  settled: number;
  /** Already processed in earlier runs. */
  skipped: number;
}

/**
 * Route every bank movement to its destination automatically:
 * preserve/stamp Meu Dinheiro records, settle name-matching payables at the
 * bank value, create what's missing. Everything ends reconciled and linked to
 * the bank id, so re-running is safe (idempotent).
 */
export async function autoProcessCora(
  ownerId: string,
  accountId: string,
  entries: NormalizedEntry[],
): Promise<AutoProcessResult> {
  const [txs, payables] = await Promise.all([
    listTransactions(ownerId),
    listBills(ownerId, "payable"),
  ]);
  const plan = planAutoProcess(entries, txs, payables, accountId);

  const result: AutoProcessResult = {
    created: 0,
    merged: 0,
    linked: 0,
    moved: 0,
    settled: 0,
    skipped: 0,
  };
  const now = Date.now();

  for (const action of plan) {
    switch (action.kind) {
      case "skip":
        result.skipped++;
        break;

      case "merge":
        // Preserve the Meu Dinheiro record: stamp it with the bank id and drop
        // the Cora-imported copy.
        await removeTransaction(ownerId, action.removeId);
        await updateDoc(doc(db, COLLECTIONS.transactions, action.keep.id!), {
          externalId: action.entry.externalId,
          reconciled: true,
        });
        result.merged++;
        break;

      case "link":
        await updateDoc(doc(db, COLLECTIONS.transactions, action.keep.id!), {
          externalId: action.entry.externalId,
          reconciled: true,
        });
        result.linked++;
        break;

      case "move":
        // The bank movement belongs to this account; fix the lançamento's account.
        await updateDoc(doc(db, COLLECTIONS.transactions, action.keep.id!), {
          accountId,
          reconciled: true,
        });
        result.moved++;
        break;

      case "settleBill":
        // Título keeps its name/classification, assumes the bank value, closes.
        await addPayment(
          action.bill.id!,
          {
            id: rid(),
            date: action.entry.date,
            amount: action.entry.amount,
            accountId,
          },
          { settle: true, externalId: action.entry.externalId, reconciled: true },
        );
        result.settled++;
        break;

      case "create": {
        const e = action.entry;
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
          reconciled: true,
          dedupHash: dedupHash({
            date: e.date,
            amount: e.amount,
            description: e.description,
            account: accountId,
          }),
          createdAt: now,
        };
        await addDoc(collection(db, COLLECTIONS.transactions), record);
        result.created++;
        break;
      }
    }
  }

  return result;
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
