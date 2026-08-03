// WalletQuantso — bills (payables/receivables) data access + writes.
//
// A bill carries its settlements inline as a `payments` array, so partial
// payments are a single-document update and the owner-scoped security rules
// stay simple. Status is never stored — it is derived from payments + due date
// by the pure helpers in lib/bills/status.

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "./firebase";
import { COLLECTIONS } from "./firestore";
import { buildBillPaymentTransaction } from "./transactions";
import type { Bill, BillKind, BillPayment } from "@/types";

function mapDocs<T>(snap: {
  docs: QueryDocumentSnapshot<DocumentData>[];
}): T[] {
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as T);
}

/** List a user's bills of a given kind. */
export async function listBills(ownerId: string, kind: BillKind): Promise<Bill[]> {
  // Filter by ownerId only (single-field, auto-provisioned index) and match the
  // `kind` in memory. Combining both equality filters in the query would need a
  // composite index to exist first, otherwise the payables/receivables screens
  // fail to load with FAILED_PRECONDITION.
  const q = query(collection(db, COLLECTIONS.bills), where("ownerId", "==", ownerId));
  return mapDocs<Bill>(await getDocs(q)).filter((b) => b.kind === kind);
}

/** Create a bill. Returns its id. */
export async function createBill(bill: Omit<Bill, "id">): Promise<string> {
  const ref = await addDoc(collection(db, COLLECTIONS.bills), bill);
  return ref.id;
}

/** Update mutable fields of a bill. */
export function updateBill(id: string, patch: Partial<Bill>): Promise<void> {
  return updateDoc(doc(db, COLLECTIONS.bills, id), patch as DocumentData);
}

/** Delete a bill. */
export function removeBill(id: string): Promise<void> {
  return deleteDoc(doc(db, COLLECTIONS.bills, id));
}

/**
 * Append a settlement to a bill and materialize it as a ledger transaction, so
 * the baixa shows up in Lançamentos and moves the account balance. The created
 * transaction id is stored on the payment for undo/consistency.
 */
export async function addPayment(id: string, payment: BillPayment): Promise<void> {
  const snap = await getDoc(doc(db, COLLECTIONS.bills, id));
  if (!snap.exists()) throw new Error("Título não encontrado.");
  const bill = { id, ...(snap.data() as Bill) };

  // Materialize the cash movement as a transaction so it shows in Lançamentos.
  const txRecord = buildBillPaymentTransaction(bill, payment);
  const txRef = await addDoc(collection(db, COLLECTIONS.transactions), txRecord);

  // Record the settlement on the bill. If this fails, roll back the transaction
  // so we never end up with a lançamento that didn't actually settle the title.
  try {
    const stored: BillPayment = { ...payment, transactionId: txRef.id };
    const payments = [...(bill.payments ?? []), stored];
    await updateDoc(doc(db, COLLECTIONS.bills, id), { payments });
  } catch (err) {
    await deleteDoc(doc(db, COLLECTIONS.transactions, txRef.id)).catch(() => {});
    throw err;
  }
}

/** Remove a settlement from a bill, deleting its materialized transaction too. */
export async function removePayment(id: string, paymentId: string): Promise<void> {
  const snap = await getDoc(doc(db, COLLECTIONS.bills, id));
  if (!snap.exists()) throw new Error("Título não encontrado.");
  const bill = snap.data() as Bill;
  const gone = (bill.payments ?? []).find((p) => p.id === paymentId);
  if (gone?.transactionId) {
    try {
      await deleteDoc(doc(db, COLLECTIONS.transactions, gone.transactionId));
    } catch {
      /* transaction may have been removed already — ignore */
    }
  }
  const payments = (bill.payments ?? []).filter((p) => p.id !== paymentId);
  await updateDoc(doc(db, COLLECTIONS.bills, id), { payments });
}

/**
 * One-time migration: materialize a transaction for every existing settlement
 * that doesn't have one yet (older baixas made before this feature). Idempotent
 * — a payment that already has a `transactionId`, or has no resolvable account,
 * is skipped. Returns how many transactions were created.
 */
export async function backfillPaymentTransactions(bills: Bill[]): Promise<number> {
  let created = 0;
  for (const b of bills) {
    if (!b.id) continue;
    const payments = [...(b.payments ?? [])];
    let changed = false;
    for (let i = 0; i < payments.length; i++) {
      const p = payments[i];
      if (p.transactionId) continue;
      const txRecord = buildBillPaymentTransaction(b, p);
      const txRef = await addDoc(collection(db, COLLECTIONS.transactions), txRecord);
      payments[i] = { ...p, transactionId: txRef.id };
      changed = true;
      created++;
    }
    if (changed) await updateDoc(doc(db, COLLECTIONS.bills, b.id), { payments });
  }
  return created;
}
