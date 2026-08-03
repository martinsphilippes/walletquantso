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
  Bill,
  BillKind,
  Category,
  Contact,
  CostCenter,
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
  createdCostCenters: string[];
  createdContacts: string[];
}

async function fetchOwnerData(ownerId: string) {
  const [accSnap, catSnap, ccSnap, ctSnap, txSnap] = await Promise.all([
    getDocs(query(collection(db, COLLECTIONS.accounts), where("ownerId", "==", ownerId))),
    getDocs(query(collection(db, COLLECTIONS.categories), where("ownerId", "==", ownerId))),
    getDocs(query(collection(db, COLLECTIONS.costCenters), where("ownerId", "==", ownerId))),
    getDocs(query(collection(db, COLLECTIONS.contacts), where("ownerId", "==", ownerId))),
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

  const costCentersByName = new Map<string, string>();
  ccSnap.forEach((d) => {
    const c = d.data() as CostCenter;
    costCentersByName.set(normalizeHeader(c.name), d.id);
  });

  const contactsByName = new Map<string, string>();
  ctSnap.forEach((d) => {
    const c = d.data() as Contact;
    contactsByName.set(normalizeHeader(c.name), d.id);
  });

  const existingHashes = new Set<string>();
  txSnap.forEach((d) => {
    const t = d.data() as Transaction;
    if (t.dedupHash) existingHashes.add(t.dedupHash);
  });

  return { accountsByName, categoriesByName, costCentersByName, contactsByName, existingHashes };
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

  const { accountsByName, categoriesByName, costCentersByName, contactsByName, existingHashes } =
    await fetchOwnerData(ownerId);

  const plan = planCommit(
    importable,
    existingHashes,
    new Set(accountsByName.keys()),
    new Set(categoriesByName.keys()),
    new Set(costCentersByName.keys()),
    new Set(contactsByName.keys()),
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
  for (const name of plan.newCostCenterNames) {
    const ref = doc(collection(db, COLLECTIONS.costCenters));
    const cc: CostCenter = { ownerId, name, createdAt: now };
    setupBatch.set(ref, cc);
    costCentersByName.set(normalizeHeader(name), ref.id);
  }
  for (const name of plan.newContactNames) {
    const ref = doc(collection(db, COLLECTIONS.contacts));
    const contact: Contact = { ownerId, name, kind: "other", createdAt: now };
    setupBatch.set(ref, contact);
    contactsByName.set(normalizeHeader(name), ref.id);
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
      const ccId = t.costCenterId
        ? (costCentersByName.get(normalizeHeader(t.costCenterId)) ?? null)
        : null;
      const contactId = t.contactId
        ? (contactsByName.get(normalizeHeader(t.contactId)) ?? null)
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
        costCenterId: ccId,
        contactId,
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
      createdCostCenters: plan.newCostCenterNames,
      createdContacts: plan.newContactNames,
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
    createdCostCenters: plan.newCostCenterNames,
    createdContacts: plan.newContactNames,
  };
}

/**
 * Undo a committed import: delete every transaction created by the batch, mark
 * the batch reverted, and append an audit entry. Accounts/categories created
 * during the import are intentionally left in place (they may now be in use).
 */
export async function revertImport(ownerId: string, batchId: string): Promise<number> {
  const now = Date.now();
  // Owner-only query + in-memory match on importBatchId (avoids a composite index).
  const snap = await getDocs(
    query(collection(db, COLLECTIONS.transactions), where("ownerId", "==", ownerId)),
  );

  const ids = snap.docs
    .filter((d) => (d.data() as { importBatchId?: string | null }).importBatchId === batchId)
    .map((d) => d.id);
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

/** Dedup key for a bill (title): kind + due date + amount (cents) + description. */
function billKey(kind: string, dueDate: string, amount: number, description: string): string {
  return `${kind}|${dueDate}|${Math.round(Math.abs(amount) * 100)}|${normalizeHeader(description)}`;
}

/**
 * Commit importable rows as bills (contas a pagar/receber) instead of
 * transactions. Reuses the same normalized rows produced by the engine: the
 * date becomes the due date, the amount the title amount, and the type decides
 * the kind (despesa → payable, receita → receivable). Accounts/categories/cost
 * centers/contacts are resolved and auto-created, exactly like the transaction
 * import. Duplicates (same kind+due date+amount+description) are skipped against
 * the file and the database. Every title is tagged with the batch id so the
 * import can be undone.
 */
export async function commitBillsImport(params: {
  ownerId: string;
  fileName: string;
  mapping: ColumnMapping;
  importable: NormalizedRow[];
}): Promise<CommitReport> {
  const { ownerId, fileName, mapping, importable } = params;
  const now = Date.now();

  const { accountsByName, categoriesByName, costCentersByName, contactsByName } =
    await fetchOwnerData(ownerId);

  // Existing bills → dedup keys (owner-only query, in-memory).
  const billSnap = await getDocs(
    query(collection(db, COLLECTIONS.bills), where("ownerId", "==", ownerId)),
  );
  const existingKeys = new Set<string>();
  billSnap.forEach((d) => {
    const b = d.data() as Bill;
    existingKeys.add(billKey(b.kind, b.dueDate, b.amount, b.description));
  });

  const exAcc = new Set(accountsByName.keys());
  const exCat = new Set(categoriesByName.keys());
  const exCc = new Set(costCentersByName.keys());
  const exCt = new Set(contactsByName.keys());
  const newAccounts = new Map<string, string>();
  const newCategories = new Map<string, string>();
  const newCostCenters = new Map<string, string>();
  const newContacts = new Map<string, string>();
  const track = (map: Map<string, string>, existing: Set<string>, name?: string | null) => {
    const n = name?.trim();
    if (!n) return;
    const norm = normalizeHeader(n);
    if (!existing.has(norm) && !map.has(norm)) map.set(norm, n);
  };

  interface Draft {
    kind: BillKind;
    dueDate: string;
    amount: number;
    description: string;
    account: string | null;
    category: string | null;
    costCenter: string | null;
    contact: string | null;
    notes: string | null;
  }
  const drafts: Draft[] = [];
  const seen = new Set<string>();
  let skippedExistingDb = 0;
  let skippedInFile = 0;

  for (const row of importable) {
    const t = row.transaction!;
    if (t.type === "transfer") continue; // transfers are not titles
    const kind: BillKind = t.type === "expense" ? "payable" : "receivable";
    const key = billKey(kind, t.date, t.amount, t.description);
    if (existingKeys.has(key)) {
      skippedExistingDb++;
      continue;
    }
    if (seen.has(key)) {
      skippedInFile++;
      continue;
    }
    seen.add(key);
    track(newAccounts, exAcc, t.accountId);
    track(newCategories, exCat, t.categoryId);
    track(newCostCenters, exCc, t.costCenterId);
    track(newContacts, exCt, t.contactId);
    drafts.push({
      kind,
      dueDate: t.date,
      amount: t.amount,
      description: t.description,
      account: t.accountId ?? null,
      category: t.categoryId ?? null,
      costCenter: t.costCenterId ?? null,
      contact: t.contactId ?? null,
      notes: t.notes ?? null,
    });
  }

  const batchRef = doc(collection(db, COLLECTIONS.importBatches));
  const batchId = batchRef.id;

  // Create missing accounts/categories/cost centers/contacts.
  const setupBatch = writeBatch(db);
  for (const name of newAccounts.values()) {
    const ref = doc(collection(db, COLLECTIONS.accounts));
    const account: Account = { ownerId, name, type: "other", initialBalance: 0, currency: "BRL", archived: false, createdAt: now };
    setupBatch.set(ref, account);
    accountsByName.set(normalizeHeader(name), ref.id);
  }
  for (const name of newCategories.values()) {
    const ref = doc(collection(db, COLLECTIONS.categories));
    const category: Category = { ownerId, name, kind: "expense", parentId: null, createdAt: now };
    setupBatch.set(ref, category);
    categoriesByName.set(normalizeHeader(name), ref.id);
  }
  for (const name of newCostCenters.values()) {
    const ref = doc(collection(db, COLLECTIONS.costCenters));
    setupBatch.set(ref, { ownerId, name, createdAt: now } as CostCenter);
    costCentersByName.set(normalizeHeader(name), ref.id);
  }
  for (const name of newContacts.values()) {
    const ref = doc(collection(db, COLLECTIONS.contacts));
    setupBatch.set(ref, { ownerId, name, kind: "other", createdAt: now } as Contact);
    contactsByName.set(normalizeHeader(name), ref.id);
  }
  await setupBatch.commit();

  // Write the bills, tagged with the batch id.
  for (let i = 0; i < drafts.length; i += BATCH_LIMIT) {
    const chunk = drafts.slice(i, i + BATCH_LIMIT);
    const batch = writeBatch(db);
    for (const d of chunk) {
      const ref = doc(collection(db, COLLECTIONS.bills));
      const bill: Bill = {
        ownerId,
        kind: d.kind,
        description: d.description,
        amount: d.amount,
        dueDate: d.dueDate,
        competenceDate: d.dueDate,
        documentNumber: null,
        categoryId: d.category ? (categoriesByName.get(normalizeHeader(d.category)) ?? null) : null,
        costCenterId: d.costCenter ? (costCentersByName.get(normalizeHeader(d.costCenter)) ?? null) : null,
        contactId: d.contact ? (contactsByName.get(normalizeHeader(d.contact)) ?? null) : null,
        accountId: d.account ? (accountsByName.get(normalizeHeader(d.account)) ?? null) : null,
        payments: [],
        installment: null,
        installmentGroupId: null,
        notes: d.notes,
        importBatchId: batchId,
        createdAt: now,
      };
      batch.set(ref, stripUndefined(bill));
    }
    await batch.commit();
  }

  const importBatch: ImportBatch = {
    ownerId,
    sourceFileName: fileName,
    status: "committed",
    mapping,
    counts: {
      total: importable.length,
      imported: drafts.length,
      ignored: skippedExistingDb + skippedInFile,
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
    details: { fileName, kind: "bills", imported: drafts.length, skippedExistingDb, skippedInFile },
    at: now,
  });
  await finalBatch.commit();

  return {
    batchId,
    imported: drafts.length,
    skippedExistingDb,
    skippedInFile,
    createdAccounts: [...newAccounts.values()],
    createdCategories: [...newCategories.values()],
    createdCostCenters: [...newCostCenters.values()],
    createdContacts: [...newContacts.values()],
  };
}

/** Undo a bills import: delete every title created by the batch. */
export async function revertBillsImport(ownerId: string, batchId: string): Promise<number> {
  const now = Date.now();
  const snap = await getDocs(
    query(collection(db, COLLECTIONS.bills), where("ownerId", "==", ownerId)),
  );
  const ids = snap.docs
    .filter((d) => (d.data() as { importBatchId?: string | null }).importBatchId === batchId)
    .map((d) => d.id);
  for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const id of ids.slice(i, i + BATCH_LIMIT)) batch.delete(doc(db, COLLECTIONS.bills, id));
    await batch.commit();
  }

  const finalBatch = writeBatch(db);
  finalBatch.update(doc(db, COLLECTIONS.importBatches, batchId), { status: "reverted", revertedAt: now });
  finalBatch.set(doc(collection(db, COLLECTIONS.auditLog)), {
    ownerId,
    action: "import_revert",
    importBatchId: batchId,
    details: { kind: "bills", deleted: ids.length },
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
