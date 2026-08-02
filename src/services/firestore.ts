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
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "./firebase";
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
} as const;

function mapDocs<T>(snap: {
  docs: QueryDocumentSnapshot<DocumentData>[];
}): T[] {
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as T);
}

/** Sort transactions newest-first by ISO date, tie-broken by creation time. */
function byDateDesc(a: Transaction, b: Transaction): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return (b.createdAt ?? 0) - (a.createdAt ?? 0);
}

/**
 * Fetch every document in a collection owned by `ownerId` using ONLY the
 * single-field `ownerId` equality filter — never combined with a second
 * `where`/`orderBy` in the query itself. That combination would require a
 * composite Firestore index to be provisioned before any read could succeed;
 * without it Firestore rejects the query with FAILED_PRECONDITION, which is
 * exactly what made saved records invisible in the list and dashboard. The
 * `ownerId`-only filter uses an automatic single-field index, so reads always
 * work; any additional filtering or ordering is done in memory (per-user
 * datasets are small).
 */
async function docsOwnedBy<T>(collectionName: string, ownerId: string): Promise<T[]> {
  const q = query(collection(db, collectionName), where("ownerId", "==", ownerId));
  return mapDocs<T>(await getDocs(q));
}

/** List the accounts owned by a user. */
export async function listAccounts(ownerId: string): Promise<Account[]> {
  const q = query(collection(db, COLLECTIONS.accounts), where("ownerId", "==", ownerId));
  return mapDocs<Account>(await getDocs(q));
}

/** Create a new account. Returns its id. */
export async function createAccount(account: Omit<Account, "id">): Promise<string> {
  const ref = await addDoc(collection(db, COLLECTIONS.accounts), account);
  return ref.id;
}

/** Update mutable fields of an account. */
export function updateAccount(id: string, patch: Partial<Account>): Promise<void> {
  return updateDoc(doc(db, COLLECTIONS.accounts, id), patch as DocumentData);
}

/** Delete an account. Callers should ensure it is not in use first. */
export function deleteAccount(id: string): Promise<void> {
  return deleteDoc(doc(db, COLLECTIONS.accounts, id));
}

/** List the categories owned by a user. */
export async function listCategories(ownerId: string): Promise<Category[]> {
  const q = query(collection(db, COLLECTIONS.categories), where("ownerId", "==", ownerId));
  return mapDocs<Category>(await getDocs(q));
}

/** List the cost centers owned by a user. */
export async function listCostCenters(ownerId: string): Promise<CostCenter[]> {
  const q = query(collection(db, COLLECTIONS.costCenters), where("ownerId", "==", ownerId));
  return mapDocs<CostCenter>(await getDocs(q));
}

/** List the contacts owned by a user. */
export async function listContacts(ownerId: string): Promise<Contact[]> {
  const q = query(collection(db, COLLECTIONS.contacts), where("ownerId", "==", ownerId));
  return mapDocs<Contact>(await getDocs(q));
}

/** List a user's transactions, newest first (ordered in memory, index-free). */
export async function listTransactions(ownerId: string): Promise<Transaction[]> {
  const rows = await docsOwnedBy<Transaction>(COLLECTIONS.transactions, ownerId);
  return rows.sort(byDateDesc);
}

/** List transactions created by a given import batch (used for undo). */
export async function listTransactionsByBatch(
  ownerId: string,
  importBatchId: string,
): Promise<Transaction[]> {
  const rows = await docsOwnedBy<Transaction>(COLLECTIONS.transactions, ownerId);
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
  const rows = await docsOwnedBy<ImportBatch>(COLLECTIONS.importBatches, ownerId);
  return rows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

/** Append an audit entry (append-only per security rules). */
export async function appendAudit(entry: Omit<AuditEntry, "id">): Promise<string> {
  const ref = await addDoc(collection(db, COLLECTIONS.auditLog), entry);
  return ref.id;
}

/** Delete a single transaction (used by the undo pipeline). */
export function deleteTransaction(id: string): Promise<void> {
  return deleteDoc(doc(db, COLLECTIONS.transactions, id));
}
