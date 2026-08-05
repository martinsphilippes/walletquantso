// WalletQuantso — manual transaction CRUD (with audit logging).
//
// Manual entries mirror the shape of imported ones but carry no importBatchId.
// Every create/update/delete appends an append-only audit entry so manual
// changes are traceable alongside imports.

import { addDoc, collection, deleteDoc, doc, updateDoc } from "firebase/firestore";
import { db } from "./firebase";
import { COLLECTIONS, appendAudit } from "./firestore";
import { dedupHash } from "@/lib/import/engine";
import type { Bill, BillPayment, Transaction, TransactionType } from "@/types";

export interface TransactionInput {
  date: string; // ISO YYYY-MM-DD
  amount: number; // positive; direction comes from `type`
  type: TransactionType;
  description: string;
  accountId: string;
  transferAccountId?: string | null;
  categoryId?: string | null;
  costCenterId?: string | null;
  contactId?: string | null;
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
    costCenterId: input.costCenterId ?? null,
    contactId: input.contactId ?? null,
    installment: null,
    installmentGroupId: null,
    importBatchId: null,
    billId: null,
    billPaymentId: null,
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

/**
 * Build the ledger transaction that materializes a bill settlement (baixa), so
 * it shows up in Lançamentos and affects account balances. `payable`
 * settlements are expenses; `receivable` settlements are income. When no account
 * can be resolved (e.g. imported títulos with no account), the entry is still
 * created with an empty account so it appears in Lançamentos — the user can
 * assign the account later, and balance math safely ignores account-less entries.
 */
export function buildBillPaymentTransaction(
  bill: Bill,
  payment: BillPayment,
  extra?: { externalId?: string | null; reconciled?: boolean },
): Transaction {
  const accountId = payment.accountId ?? bill.accountId ?? "";
  const type: TransactionType = bill.kind === "receivable" ? "income" : "expense";
  const record: Transaction = {
    ownerId: bill.ownerId,
    date: payment.date,
    amount: Math.abs(payment.amount),
    type,
    description: bill.description,
    accountId,
    categoryId: bill.categoryId ?? null,
    transferAccountId: null,
    costCenterId: bill.costCenterId ?? null,
    contactId: bill.contactId ?? null,
    installment: null,
    installmentGroupId: null,
    importBatchId: null,
    billId: bill.id ?? null,
    billPaymentId: payment.id,
    notes: bill.kind === "receivable" ? "Baixa de conta a receber" : "Baixa de conta a pagar",
    externalId: extra?.externalId ?? null,
    dedupHash: dedupHash({
      date: payment.date,
      amount: payment.amount,
      description: bill.description,
      account: accountId,
    }),
    createdAt: Date.now(),
  };
  if (extra?.reconciled) record.reconciled = true;
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

/** Toggle the bank-reconciliation (cleared) flag on a transaction. */
export function setReconciled(id: string, reconciled: boolean): Promise<void> {
  return updateDoc(doc(db, COLLECTIONS.transactions, id), { reconciled });
}

/**
 * Apply the same classification patch (categoria / centro de custo / contato)
 * to many transactions at once. Only the given fields change; one audit entry
 * records the batch.
 */
export async function bulkPatchTransactions(
  ownerId: string,
  ids: string[],
  patch: Partial<Pick<Transaction, "categoryId" | "costCenterId" | "contactId">>,
): Promise<void> {
  for (const id of ids) {
    await updateDoc(doc(db, COLLECTIONS.transactions, id), patch as Record<string, unknown>);
  }
  await appendAudit({
    ownerId,
    action: "manual_update",
    details: { bulk: true, count: ids.length, patch },
    at: Date.now(),
  });
}

/** Delete a transaction. */
export async function removeTransaction(ownerId: string, id: string): Promise<void> {
  const now = Date.now();
  await deleteDoc(doc(db, COLLECTIONS.transactions, id));
  await appendAudit({ ownerId, action: "manual_delete", details: { id }, at: now });
}
