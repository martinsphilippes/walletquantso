// Pure planning for an import commit.
//
// Given the importable rows plus what already exists in the database, decide
// exactly what will be written: which rows to create, which to skip as
// duplicates (against the DB or against earlier rows in the same file), and
// which accounts/categories need to be created first. No I/O here so the
// decision logic stays unit-testable; the service layer performs the writes.

import { normalizeHeader, type NormalizedRow } from "./engine";

export interface CommitPlan {
  /** Rows that will be inserted. */
  toCreate: NormalizedRow[];
  /** Rows skipped because an identical entry already exists in the DB. */
  skippedExistingDb: NormalizedRow[];
  /** Rows skipped because an earlier row in this file is identical. */
  skippedInFile: NormalizedRow[];
  /** Distinct account names (original casing) that must be created. */
  newAccountNames: string[];
  /** Distinct category names (original casing) that must be created. */
  newCategoryNames: string[];
  /** Distinct cost center names (original casing) that must be created. */
  newCostCenterNames: string[];
  /** Distinct contact names (original casing) that must be created. */
  newContactNames: string[];
}

/**
 * Build a commit plan.
 *
 * @param importable      Rows that passed validation (each has a transaction).
 * @param existingHashes  dedupHash values already present in the DB.
 * @param existingAccounts Normalized names of accounts already in the DB.
 * @param existingCategories Normalized names of categories already in the DB.
 */
export function planCommit(
  importable: NormalizedRow[],
  existingHashes: Set<string>,
  existingAccounts: Set<string>,
  existingCategories: Set<string>,
  existingCostCenters: Set<string> = new Set(),
  existingContacts: Set<string> = new Set(),
): CommitPlan {
  const toCreate: NormalizedRow[] = [];
  const skippedExistingDb: NormalizedRow[] = [];
  const skippedInFile: NormalizedRow[] = [];

  const seenInFile = new Set<string>();
  const newAccounts = new Map<string, string>(); // normalized -> original
  const newCategories = new Map<string, string>();
  const newCostCenters = new Map<string, string>();
  const newContacts = new Map<string, string>();

  for (const row of importable) {
    const t = row.transaction!;
    if (existingHashes.has(t.dedupHash)) {
      skippedExistingDb.push(row);
      continue;
    }
    if (seenInFile.has(t.dedupHash)) {
      skippedInFile.push(row);
      continue;
    }
    seenInFile.add(t.dedupHash);
    toCreate.push(row);

    // Both the source account and (for transfers) the destination account
    // must exist before the transaction is written.
    for (const accName of [t.accountId?.trim(), t.transferAccountId?.trim()]) {
      if (!accName) continue;
      const norm = normalizeHeader(accName);
      if (!existingAccounts.has(norm) && !newAccounts.has(norm)) {
        newAccounts.set(norm, accName);
      }
    }
    const catName = t.categoryId?.trim();
    if (catName) {
      const norm = normalizeHeader(catName);
      if (!existingCategories.has(norm) && !newCategories.has(norm)) {
        newCategories.set(norm, catName);
      }
    }
    const ccName = t.costCenterId?.trim();
    if (ccName) {
      const norm = normalizeHeader(ccName);
      if (!existingCostCenters.has(norm) && !newCostCenters.has(norm)) {
        newCostCenters.set(norm, ccName);
      }
    }
    const contactName = t.contactId?.trim();
    if (contactName) {
      const norm = normalizeHeader(contactName);
      if (!existingContacts.has(norm) && !newContacts.has(norm)) {
        newContacts.set(norm, contactName);
      }
    }
  }

  return {
    toCreate,
    skippedExistingDb,
    skippedInFile,
    newAccountNames: [...newAccounts.values()],
    newCategoryNames: [...newCategories.values()],
    newCostCenterNames: [...newCostCenters.values()],
    newContactNames: [...newContacts.values()],
  };
}
