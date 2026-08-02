// WalletQuantso — cost center management (Firestore writes).
//
// Create/rename/delete cost centers, plus a merge that reassigns every
// transaction from a source cost center to a target and then deletes the
// source.

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
import type { CostCenter } from "@/types";

const BATCH_LIMIT = 400;

/** Create a cost center. Returns its id. */
export async function createCostCenter(costCenter: Omit<CostCenter, "id">): Promise<string> {
  const ref = await addDoc(collection(db, COLLECTIONS.costCenters), costCenter);
  return ref.id;
}

/** Update mutable fields of a cost center. */
export function updateCostCenter(id: string, patch: Partial<CostCenter>): Promise<void> {
  return updateDoc(doc(db, COLLECTIONS.costCenters, id), patch as DocumentData);
}

/** Delete a cost center. Callers should ensure it is not in use first. */
export function removeCostCenter(id: string): Promise<void> {
  return deleteDoc(doc(db, COLLECTIONS.costCenters, id));
}

/**
 * Merge `sourceId` into `targetId`: every transaction using the source cost
 * center is reassigned to the target, then the source is deleted. Returns the
 * number of transactions moved.
 */
export async function mergeCostCenters(
  ownerId: string,
  sourceId: string,
  targetId: string,
): Promise<number> {
  if (sourceId === targetId) return 0;

  const snap = await getDocs(
    query(
      collection(db, COLLECTIONS.transactions),
      where("ownerId", "==", ownerId),
      where("costCenterId", "==", sourceId),
    ),
  );
  const ids = snap.docs.map((d) => d.id);
  for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const id of ids.slice(i, i + BATCH_LIMIT)) {
      batch.update(doc(db, COLLECTIONS.transactions, id), { costCenterId: targetId });
    }
    await batch.commit();
  }

  await deleteDoc(doc(db, COLLECTIONS.costCenters, sourceId));
  return ids.length;
}
