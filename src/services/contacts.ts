// WalletQuantso — contact management (Firestore writes).
//
// Create/rename/delete contacts (pessoas / fornecedores), plus a merge that
// reassigns every transaction from a source contact to a target and then
// deletes the source.

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
} from "firebase/firestore";
import { db } from "./firebase";
import { COLLECTIONS } from "./firestore";
import type { Contact } from "@/types";

const BATCH_LIMIT = 400;

/** Create a contact. Returns its id. */
export async function createContact(contact: Omit<Contact, "id">): Promise<string> {
  const ref = await addDoc(collection(db, COLLECTIONS.contacts), contact);
  return ref.id;
}

/** Update mutable fields of a contact. */
export async function updateContact(id: string, patch: Partial<Contact>): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.contacts, id), patch as DocumentData);
}

/** Delete a contact. Callers should ensure it is not in use first. */
export async function removeContact(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.contacts, id));
}

/**
 * Delete a contact even when it is in use: every transaction/bill that
 * referenced it has its `contactId` cleared (kept, but "sem contato") and then
 * the contact is removed. No financial record is deleted. Returns how many
 * records were unassigned.
 */
export async function deleteContactDeep(
  ownerId: string,
  contactId: string,
): Promise<{ unassigned: number }> {
  const [txSnap, billSnap] = await Promise.all([
    getDocs(query(collection(db, COLLECTIONS.transactions), where("ownerId", "==", ownerId))),
    getDocs(query(collection(db, COLLECTIONS.bills), where("ownerId", "==", ownerId))),
  ]);
  const matches = (d: { data: () => unknown }) =>
    (d.data() as { contactId?: string | null }).contactId === contactId;
  const txToClear = txSnap.docs.filter(matches);
  const billToClear = billSnap.docs.filter(matches);

  type Op = { kind: "clearTx" | "clearBill"; id: string };
  const ops: Op[] = [
    ...txToClear.map((d) => ({ kind: "clearTx" as const, id: d.id })),
    ...billToClear.map((d) => ({ kind: "clearBill" as const, id: d.id })),
  ];
  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const op of ops.slice(i, i + BATCH_LIMIT)) {
      if (op.kind === "clearTx") {
        batch.update(doc(db, COLLECTIONS.transactions, op.id), { contactId: null });
      } else {
        batch.update(doc(db, COLLECTIONS.bills, op.id), { contactId: null });
      }
    }
    await batch.commit();
  }

  await deleteDoc(doc(db, COLLECTIONS.contacts, contactId));
  return { unassigned: txToClear.length + billToClear.length };
}

/**
 * Merge `sourceId` into `targetId`: every transaction using the source contact
 * is reassigned to the target, then the source is deleted. Returns the number
 * of transactions moved.
 */
export async function mergeContacts(
  ownerId: string,
  sourceId: string,
  targetId: string,
): Promise<number> {
  if (sourceId === targetId) return 0;

  // Owner-only query (single-field index) + in-memory match on contactId, to
  // avoid requiring a composite index.
  const snap = await getDocs(
    query(collection(db, COLLECTIONS.transactions), where("ownerId", "==", ownerId)),
  );
  const ids = snap.docs
    .filter((d) => (d.data() as { contactId?: string | null }).contactId === sourceId)
    .map((d) => d.id);
  for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const id of ids.slice(i, i + BATCH_LIMIT)) {
      batch.update(doc(db, COLLECTIONS.transactions, id), { contactId: targetId });
    }
    await batch.commit();
  }

  await deleteDoc(doc(db, COLLECTIONS.contacts, sourceId));
  return ids.length;
}
