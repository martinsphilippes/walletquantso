// WalletQuantso — category management (Firestore writes).
//
// Create/rename/retype/delete categories, plus a merge that reassigns every
// transaction from a source category to a target and then deletes the source.

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
import type { Category } from "@/types";

const BATCH_LIMIT = 400;

/** Create a category (or subcategory when parentId is set). Returns its id. */
export async function createCategory(category: Omit<Category, "id">): Promise<string> {
  const ref = await addDoc(collection(db, COLLECTIONS.categories), category);
  return ref.id;
}

/** Update mutable fields of a category. */
export function updateCategory(id: string, patch: Partial<Category>): Promise<void> {
  return updateDoc(doc(db, COLLECTIONS.categories, id), patch as DocumentData);
}

/** Delete a category. Callers should ensure it is not in use first. */
export function removeCategory(id: string): Promise<void> {
  return deleteDoc(doc(db, COLLECTIONS.categories, id));
}

/** Reparent every subcategory of a category to a new parent (or null). */
async function reparentChildren(
  ownerId: string,
  parentId: string,
  newParentId: string | null,
): Promise<void> {
  // Owner-only query + in-memory match on parentId (avoids a composite index).
  const snap = await getDocs(
    query(collection(db, COLLECTIONS.categories), where("ownerId", "==", ownerId)),
  );
  const ids = snap.docs
    .filter((d) => (d.data() as { parentId?: string | null }).parentId === parentId)
    .map((d) => d.id);
  for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const id of ids.slice(i, i + BATCH_LIMIT)) {
      batch.update(doc(db, COLLECTIONS.categories, id), { parentId: newParentId });
    }
    await batch.commit();
  }
}

/**
 * Merge `sourceId` into `targetId`: every transaction using the source is
 * reassigned to the target, any subcategories are reparented to the target,
 * and the source category is deleted. Returns the number of transactions moved.
 */
export async function mergeCategories(
  ownerId: string,
  sourceId: string,
  targetId: string,
): Promise<number> {
  if (sourceId === targetId) return 0;

  // Owner-only query + in-memory match on categoryId (avoids a composite index).
  const snap = await getDocs(
    query(collection(db, COLLECTIONS.transactions), where("ownerId", "==", ownerId)),
  );
  const ids = snap.docs
    .filter((d) => (d.data() as { categoryId?: string | null }).categoryId === sourceId)
    .map((d) => d.id);
  for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const id of ids.slice(i, i + BATCH_LIMIT)) {
      batch.update(doc(db, COLLECTIONS.transactions, id), { categoryId: targetId });
    }
    await batch.commit();
  }

  await reparentChildren(ownerId, sourceId, targetId);
  await deleteDoc(doc(db, COLLECTIONS.categories, sourceId));
  return ids.length;
}
