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
export async function updateCostCenter(id: string, patch: Partial<CostCenter>): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.costCenters, id), patch as DocumentData);
}

/** Delete a cost center. Callers should ensure it is not in use first. */
export async function removeCostCenter(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.costCenters, id));
}

/**
 * Delete a cost center even when it is in use: every transaction/bill that
 * referenced it has its `costCenterId` cleared (kept, but "sem centro") and then
 * the cost center is removed. No financial record is deleted. Returns how many
 * records were unassigned.
 */
export async function deleteCostCenterDeep(
  ownerId: string,
  costCenterId: string,
): Promise<{ unassigned: number }> {
  const [txSnap, billSnap] = await Promise.all([
    getDocs(query(collection(db, COLLECTIONS.transactions), where("ownerId", "==", ownerId))),
    getDocs(query(collection(db, COLLECTIONS.bills), where("ownerId", "==", ownerId))),
  ]);
  const matches = (d: { data: () => unknown }) =>
    (d.data() as { costCenterId?: string | null }).costCenterId === costCenterId;
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
        batch.update(doc(db, COLLECTIONS.transactions, op.id), { costCenterId: null });
      } else {
        batch.update(doc(db, COLLECTIONS.bills, op.id), { costCenterId: null });
      }
    }
    await batch.commit();
  }

  await deleteDoc(doc(db, COLLECTIONS.costCenters, costCenterId));
  return { unassigned: txToClear.length + billToClear.length };
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

  // Owner-only query + in-memory match on costCenterId (avoids a composite index).
  const snap = await getDocs(
    query(collection(db, COLLECTIONS.transactions), where("ownerId", "==", ownerId)),
  );
  const ids = snap.docs
    .filter((d) => (d.data() as { costCenterId?: string | null }).costCenterId === sourceId)
    .map((d) => d.id);
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
