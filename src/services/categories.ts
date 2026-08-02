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

/**
 * Delete a category together with everything blocking its removal: its direct
 * subcategories are deleted too, and every transaction/bill that referenced any
 * of them has its `categoryId` cleared (kept, but left "sem categoria") so no
 * financial record is destroyed. Returns how many categories were deleted and
 * how many records were unassigned.
 */
export async function deleteCategoryDeep(
  ownerId: string,
  categoryId: string,
): Promise<{ deletedCategories: number; unassigned: number }> {
  const catsSnap = await getDocs(
    query(collection(db, COLLECTIONS.categories), where("ownerId", "==", ownerId)),
  );
  const targetIds = new Set<string>([categoryId]);
  for (const d of catsSnap.docs) {
    if ((d.data() as { parentId?: string | null }).parentId === categoryId) targetIds.add(d.id);
  }

  const [txSnap, billSnap] = await Promise.all([
    getDocs(query(collection(db, COLLECTIONS.transactions), where("ownerId", "==", ownerId))),
    getDocs(query(collection(db, COLLECTIONS.bills), where("ownerId", "==", ownerId))),
  ]);
  const matches = (d: { data: () => unknown }) =>
    targetIds.has(String((d.data() as { categoryId?: string | null }).categoryId ?? ""));
  const txToClear = txSnap.docs.filter(matches);
  const billToClear = billSnap.docs.filter(matches);

  type Op = { kind: "clearTx" | "clearBill" | "delCat"; id: string };
  const ops: Op[] = [
    ...txToClear.map((d) => ({ kind: "clearTx" as const, id: d.id })),
    ...billToClear.map((d) => ({ kind: "clearBill" as const, id: d.id })),
    ...[...targetIds].map((id) => ({ kind: "delCat" as const, id })),
  ];

  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const op of ops.slice(i, i + BATCH_LIMIT)) {
      if (op.kind === "clearTx") {
        batch.update(doc(db, COLLECTIONS.transactions, op.id), { categoryId: null });
      } else if (op.kind === "clearBill") {
        batch.update(doc(db, COLLECTIONS.bills, op.id), { categoryId: null });
      } else {
        batch.delete(doc(db, COLLECTIONS.categories, op.id));
      }
    }
    await batch.commit();
  }

  return { deletedCategories: targetIds.size, unassigned: txToClear.length + billToClear.length };
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
