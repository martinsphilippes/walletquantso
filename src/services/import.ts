// WalletQuantso — import commit & undo (Firestore writes).
//
// Orchestrates the auditable write pipeline on top of the pure planCommit
// logic. Every transaction is stamped with an `importBatchId` so a batch can
// be fully undone, and every commit/revert appends an append-only audit entry.

import {
  collection,
  doc,
  writeBatch,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { db } from "./firebase";
import { COLLECTIONS } from "./firestore";
import { planCommit } from "@/lib/import/commit-plan";
import { normalizeHeader, type NormalizedRow } from "@/lib/import/engine";
import type {
  Account,
  Category,
  ColumnMapping,
  ImportBatch,
  Transaction,
} from "@/types";

/** Firestore writeBatch caps at 500 operations; stay safely under it. */
const BATCH_LIMIT = 400;

export interface CommitReport {
  batchId: string;
  imported: number;
  skippedExistingDb: number;
  skippedInFile: number;
  createdAccounts: string[];
  createdCategories: string[];
}

async function fetchOwnerData(ownerId: string) {
  const [accSnap, catSnap, txSnap] = await Promise.all([
    getDocs(query(collection(db, COLLECTIONS.accounts), where("ownerId", "==", ownerId))),
    getDocs(query(collection(db, COLLECTIONS.categories), where("ownerId", "==", ownerId))),
    getDocs(query(collection(db, COLLECTIONS.transactions), where("ownerId", "==", ownerId))),
  ]);

  const accountsByName = new Map<string, string>(); // normalized name -> id
  accSnap.forEach((d) => {
    const a = d.data() as Account;
    accountsByName.set(normalizeHeader(a.name), d.id);
  });

  const categoriesByName = new Map<string, string>();
  catSnap.forEach((d) => {
    const c = d.data() as Category;
    categoriesByName.set(normalizeHeader(c.name), d.id);
  });

  const existingHashes = new Set<string>();
  txSnap.forEach((d) => {
    const t = d.data() as Transaction;
    if (t.dedupHash) existingHashes.add(t.dedupHash);
  });

  return { accountsByName, categoriesByName, existingHashes };
}

/**
 * Commit a preview's importable rows to Firestore, skipping duplicates and
 * creating any missing accounts/categories. Returns a report of what happened.
 */
export async function commitImport(params: {
  ownerId: string;
  fileName: string;
  mapping: ColumnMapping;
  importable: NormalizedRow[];
}): Promise<CommitReport> {
  const { ownerId, fileName, mapping, importable } = params;
  const now = Date.now();

  const { accountsByName, categoriesByName, existingHashes } = await fetchOwnerData(ownerId);

  const plan = planCommit(
    importable,
    existingHashes,
    new Set(accountsByName.keys()),
    new Set(categoriesByName.keys()),
  );

  // Pre-generate the batch id so every transaction can reference it.
  const batchRef = doc(collection(db, COLLECTIONS.importBatches));
  const batchId = batchRef.id;

  // Create missing accounts and categories, extending the name->id maps.
  const setupBatch = writeBatch(db);
  for (const name of plan.newAccountNames) {
    const ref = doc(collection(db, COLLECTIONS.accounts));
    const account: Account = {
      ownerId,
      name,
      type: "other",
      initialBalance: 0,
      currency: "BRL",
      archived: false,
      createdAt: now,
    };
    setupBatch.set(ref, account);
    accountsByName.set(normalizeHeader(name), ref.id);
  }
  for (const name of plan.newCategoryNames) {
    const ref = doc(collection(db, COLLECTIONS.categories));
    const category: Category = {
      ownerId,
      name,
      kind: "expense",
      parentId: null,
      createdAt: now,
    };
    setupBatch.set(ref, category);
    categoriesByName.set(normalizeHeader(name), ref.id);
  }
  await setupBatch.commit();

  // Write transactions in chunks, each tagged with the batch id.
  for (let i = 0; i < plan.toCreate.length; i += BATCH_LIMIT) {
    const chunk = plan.toCreate.slice(i, i + BATCH_LIMIT);
    const batch = writeBatch(db);
    for (const row of chunk) {
      const t = row.transaction!;
      const ref = doc(collection(db, COLLECTIONS.transactions));
      const accId = accountsByName.get(normalizeHeader(t.accountId)) ?? null;
      const catId = t.categoryId
        ? (categoriesByName.get(normalizeHeader(t.categoryId)) ?? null)
        : null;
      const transferId = t.transferAccountId
        ? (accountsByName.get(normalizeHeader(t.transferAccountId)) ?? t.transferAccountId)
        : null;
      const transaction: Transaction = {
        ownerId,
        date: t.date,
        amount: t.amount,
        type: t.type,
        description: t.description,
        notes: t.notes,
        accountId: accId ?? t.accountId,
        categoryId: catId,
        costCenterId: t.costCenterId ?? null,
        transferAccountId: transferId,
        installment: t.installment ?? null,
        installmentGroupId: t.installmentGroupId ?? null,
        tags: t.tags,
        importBatchId: batchId,
        dedupHash: t.dedupHash,
        createdAt: now,
      };
      batch.set(ref, stripUndefined(transaction));
    }
    await batch.commit();
  }

  // Record the batch and an audit entry.
  const importBatch: ImportBatch = {
    ownerId,
    sourceFileName: fileName,
    status: "committed",
    mapping,
    counts: {
      total: importable.length,
      imported: plan.toCreate.length,
      ignored: plan.skippedExistingDb.length + plan.skippedInFile.length,
      rejected: 0,
    },
    createdAt: now,
    committedAt: now,
    revertedAt: null,
  };
  const finalBatch = writeBatch(db);
  finalBatch.set(batchRef, importBatch);
  finalBatch.set(doc(collection(db, COLLECTIONS.auditLog)), {
    ownerId,
    action: "import_commit",
    importBatchId: batchId,
    details: {
      fileName,
      imported: plan.toCreate.length,
      skippedExistingDb: plan.skippedExistingDb.length,
      skippedInFile: plan.skippedInFile.length,
      createdAccounts: plan.newAccountNames,
      createdCategories: plan.newCategoryNames,
    },
    at: now,
  });
  await finalBatch.commit();

  return {
    batchId,
    imported: plan.toCreate.length,
    skippedExistingDb: plan.skippedExistingDb.length,
    skippedInFile: plan.skippedInFile.length,
    createdAccounts: plan.newAccountNames,
    createdCategories: plan.newCategoryNames,
  };
}

/**
 * Undo a committed import: delete every transaction created by the batch, mark
 * the batch reverted, and append an audit entry. Accounts/categories created
 * during the import are intentionally left in place (they may now be in use).
 */
export async function revertImport(ownerId: string, batchId: string): Promise<number> {
  const now = Date.now();
  const snap = await getDocs(
    query(
      collection(db, COLLECTIONS.transactions),
      where("ownerId", "==", ownerId),
      where("importBatchId", "==", batchId),
    ),
  );

  const ids = snap.docs.map((d) => d.id);
  for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
    const chunk = ids.slice(i, i + BATCH_LIMIT);
    const batch = writeBatch(db);
    for (const id of chunk) batch.delete(doc(db, COLLECTIONS.transactions, id));
    await batch.commit();
  }

  const finalBatch = writeBatch(db);
  finalBatch.update(doc(db, COLLECTIONS.importBatches, batchId), {
    status: "reverted",
    revertedAt: now,
  });
  finalBatch.set(doc(collection(db, COLLECTIONS.auditLog)), {
    ownerId,
    action: "import_revert",
    importBatchId: batchId,
    details: { deleted: ids.length },
    at: now,
  });
  await finalBatch.commit();

  return ids.length;
}

/** Firestore rejects `undefined` field values; drop them. */
function stripUndefined<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}
