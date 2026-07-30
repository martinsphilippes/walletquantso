// WalletQuantso — manual transaction CRUD (with audit logging).
//
// Manual entries mirror the shape of imported ones but carry no importBatchId.
// Every create/update/delete appends an append-only audit entry so manual
// changes are traceable alongside imports.

import { addDoc, collection, deleteDoc, doc, updateDoc } from "firebase/firestore";
import { db } from "./firebase";
import { COLLECTIONS, appendAudit } from "./firestore";
import { dedupHash } from "@/lib/import/engine";
import type { Transaction, TransactionType } from "@/types";

export interface TransactionInput {
  date: string; // ISO YYYY-MM-DD
  amount: number; // positive; direction comes from `type`
  type: TransactionType;
  description: string;
  accountId: string;
  transferAccountId?: string | null;
  categoryId?: string | null;
  notes?: string;
}

function buildRecord(ownerId: string, input: TransactionInput, createdAt: number): Transaction {
  const record: Transaction = {
    ownerId,
    date: input.date,
    amount: Math.abs(input.amount),
    type: input.type,
    description: input.description,
    accountId: input.accountId,
    categoryId: input.categoryId ?? null,
    transferAccountId: input.type === "transfer" ? (input.transferAccountId ?? null) : null,
    costCenterId: null,
    installment: null,
    installmentGroupId: null,
    importBatchId: null,
    dedupHash: dedupHash({
      date: input.date,
      amount: input.amount,
      description: input.description,
      account: input.accountId,
    }),
    createdAt,
  };
  if (input.notes && input.notes.trim()) record.notes = input.notes.trim();
  return record;
}

/** Create a manual transaction. Returns its id. */
export async function createTransaction(
  ownerId: string,
  input: TransactionInput,
): Promise<string> {
  const now = Date.now();
  const ref = await addDoc(collection(db, COLLECTIONS.transactions), buildRecord(ownerId, input, now));
  await appendAudit({
    ownerId,
    action: "manual_create",
    details: { id: ref.id, description: input.description, amount: input.amount },
    at: now,
  });
  return ref.id;
}

/** Update an existing transaction (recomputes the dedup hash). */
export async function updateTransaction(
  ownerId: string,
  id: string,
  input: TransactionInput,
): Promise<void> {
  const now = Date.now();
  const record = buildRecord(ownerId, input, now);
  // Keep the original createdAt; only content fields change.
  const { createdAt: _omit, ...patch } = record;
  void _omit;
  await updateDoc(doc(db, COLLECTIONS.transactions, id), {
    ...patch,
    notes: input.notes?.trim() ?? null,
  });
  await appendAudit({
    ownerId,
    action: "manual_update",
    details: { id, description: input.description, amount: input.amount },
    at: now,
  });
}

/** Delete a transaction. */
export async function removeTransaction(ownerId: string, id: string): Promise<void> {
  const now = Date.now();
  await deleteDoc(doc(db, COLLECTIONS.transactions, id));
  await appendAudit({ ownerId, action: "manual_delete", details: { id }, at: now });
}
