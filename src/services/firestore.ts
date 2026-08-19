// WalletQuantso — Firestore data-access helpers.
//
// Thin, typed wrappers over the owner-scoped collections. Read/write access is
// additionally enforced server-side by firestore.rules. The import
// commit/undo pipeline (batched writes tagged with importBatchId) will build
// on top of these primitives.

import {
  collection,
  doc,
  addDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  type DocumentData,
} from "firebase/firestore";
import { db } from "./firebase";
import { liveList } from "./live-store";
import type {
  Account,
  AuditEntry,
  Category,
  Contact,
  CostCenter,
  ImportBatch,
  Transaction,
} from "@/types";

export const COLLECTIONS = {
  accounts: "accounts",
  categories: "categories",
  costCenters: "costCenters",
  contacts: "contacts",
  bills: "bills",
  transactions: "transactions",
  importBatches: "importBatches",
  auditLog: "auditLog",
  clients: "clients",
  clientBillings: "clientBillings",
} as const;

/** Sort transactions newest-first by ISO date, tie-broken by creation time. */
function byDateDesc(a: Transaction, b: Transaction): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return (b.createdAt ?? 0) - (a.createdAt ?? 0);
}

/** List the accounts owned by a user. */
export function listAccounts(ownerId: string): Promise<Account[]> {
  return liveList<Account>(COLLECTIONS.accounts, ownerId);
}

/** Create a new account. Returns its id. */
export async function createAccount(account: Omit<Account, "id">): Promise<string> {
  const ref = await addDoc(collection(db, COLLECTIONS.accounts), account);
  return ref.id;
}

/** Update mutable fields of an account. */
export async function updateAccount(id: string, patch: Partial<Account>): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.accounts, id), patch as DocumentData);
}

/** Delete an account. Callers should ensure it is not in use first. */
export async function deleteAccount(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.accounts, id));
}

/** List the categories owned by a user. */
export function listCategories(ownerId: string): Promise<Category[]> {
  return liveList<Category>(COLLECTIONS.categories, ownerId);
}

/** List the cost centers owned by a user. */
export function listCostCenters(ownerId: string): Promise<CostCenter[]> {
  return liveList<CostCenter>(COLLECTIONS.costCenters, ownerId);
}

/** List the contacts owned by a user. */
export function listContacts(ownerId: string): Promise<Contact[]> {
  return liveList<Contact>(COLLECTIONS.contacts, ownerId);
}

/** List a user's transactions, newest first (ordered in memory, index-free). */
export async function listTransactions(ownerId: string): Promise<Transaction[]> {
  const rows = await liveList<Transaction>(COLLECTIONS.transactions, ownerId);
  return rows.sort(byDateDesc);
}

/** List transactions created by a given import batch (used for undo). */
export async function listTransactionsByBatch(
  ownerId: string,
  importBatchId: string,
): Promise<Transaction[]> {
  const rows = await liveList<Transaction>(COLLECTIONS.transactions, ownerId);
  return rows.filter((t) => t.importBatchId === importBatchId);
}

/** Create an import batch (starts in `preview`). Returns its id. */
export async function createImportBatch(batch: Omit<ImportBatch, "id">): Promise<string> {
  const ref = await addDoc(collection(db, COLLECTIONS.importBatches), batch);
  return ref.id;
}

/** Read an import batch by id. */
export async function getImportBatch(id: string): Promise<ImportBatch | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.importBatches, id));
  return snap.exists() ? ({ id: snap.id, ...(snap.data() as object) } as ImportBatch) : null;
}

/** List a user's import batches, newest first. */
export async function listImportBatches(ownerId: string): Promise<ImportBatch[]> {
  const rows = await liveList<ImportBatch>(COLLECTIONS.importBatches, ownerId);
  return rows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

/** Append an audit entry (append-only per security rules). */
export async function appendAudit(entry: Omit<AuditEntry, "id">): Promise<string> {
  const ref = await addDoc(collection(db, COLLECTIONS.auditLog), entry);
  return ref.id;
}

/** Delete a single transaction (used by the undo pipeline). */
export async function deleteTransaction(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.transactions, id));
}
