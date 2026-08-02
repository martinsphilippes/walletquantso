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

/** Append a settlement to a bill (read-modify-write on the payments array). */
export async function addPayment(id: string, payment: BillPayment): Promise<void> {
  const snap = await getDoc(doc(db, COLLECTIONS.bills, id));
  if (!snap.exists()) throw new Error("Título não encontrado.");
  const bill = snap.data() as Bill;
  const payments = [...(bill.payments ?? []), payment];
  await updateDoc(doc(db, COLLECTIONS.bills, id), { payments });
}

/** Remove a settlement from a bill by payment id. */
export async function removePayment(id: string, paymentId: string): Promise<void> {
  const snap = await getDoc(doc(db, COLLECTIONS.bills, id));
  if (!snap.exists()) throw new Error("Título não encontrado.");
  const bill = snap.data() as Bill;
  const payments = (bill.payments ?? []).filter((p) => p.id !== paymentId);
  await updateDoc(doc(db, COLLECTIONS.bills, id), { payments });
}
