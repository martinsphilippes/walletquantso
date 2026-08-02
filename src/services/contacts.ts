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
export function updateContact(id: string, patch: Partial<Contact>): Promise<void> {
  return updateDoc(doc(db, COLLECTIONS.contacts, id), patch as DocumentData);
}

/** Delete a contact. Callers should ensure it is not in use first. */
export function removeContact(id: string): Promise<void> {
  return deleteDoc(doc(db, COLLECTIONS.contacts, id));
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
