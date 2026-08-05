// WalletQuantso — scheduled Cora auto-sync (server-only).
//
// Runs without a browser: reads each owner's enabled coraSync config, fetches
// new Cora movements and writes them as lançamentos via the Admin SDK, skipping
// anything already imported (dedup by `externalId`). Called by the cron route.

import { getAdminDb } from "./firebase-admin";
import { fetchCoraStatement } from "./cora";
import { dedupHash } from "@/lib/import/engine";
import type { CoraSyncConfig } from "@/types";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86400000));

/** Overlap window (days) re-scanned each run to catch late-posted entries. */
const OVERLAP_DAYS = 5;
/** Default look-back the first time an owner enables the sync. */
const FIRST_RUN_DAYS = 30;

export interface SyncOutcome {
  owners: number;
  created: number;
  details: Array<{ ownerId: string; created: number; skipped: number; error?: string }>;
}

export async function runCoraSync(): Promise<SyncOutcome> {
  const db = getAdminDb();
  const snap = await db.collection("coraSync").where("enabled", "==", true).get();

  const outcome: SyncOutcome = { owners: 0, created: 0, details: [] };

  for (const doc of snap.docs) {
    const cfg = doc.data() as CoraSyncConfig;
    outcome.owners++;
    const detail = { ownerId: cfg.ownerId, created: 0, skipped: 0 as number, error: undefined as string | undefined };
    try {
      if (!cfg.accountId) throw new Error("Conta de destino não definida.");

      // Range: from a few days before the last synced date (or the first-run
      // look-back) up to today.
      const start = cfg.lastSyncedDate
        ? iso(new Date(Date.parse(cfg.lastSyncedDate) - OVERLAP_DAYS * 86400000))
        : daysAgo(FIRST_RUN_DAYS);
      const end = daysAgo(0);

      const { entries } = await fetchCoraStatement({ start, end });

      // Existing external ids for this owner (index-free: single where).
      const existing = await db
        .collection("transactions")
        .where("ownerId", "==", cfg.ownerId)
        .get();
      const seen = new Set<string>();
      for (const t of existing.docs) {
        const ext = (t.data() as { externalId?: string | null }).externalId;
        if (ext) seen.add(ext);
      }

      const now = Date.now();
      let maxDate = cfg.lastSyncedDate ?? "";
      for (const e of entries) {
        if (seen.has(e.externalId)) {
          detail.skipped++;
          continue;
        }
        await db.collection("transactions").add({
          ownerId: cfg.ownerId,
          date: e.date,
          amount: e.amount,
          type: e.type,
          description: e.description,
          accountId: cfg.accountId,
          categoryId: null,
          transferAccountId: null,
          costCenterId: null,
          contactId: null,
          installment: null,
          installmentGroupId: null,
          importBatchId: null,
          externalId: e.externalId,
          dedupHash: dedupHash({
            date: e.date,
            amount: e.amount,
            description: e.description,
            account: cfg.accountId,
          }),
          createdAt: now,
        });
        seen.add(e.externalId);
        detail.created++;
        if (e.date > maxDate) maxDate = e.date;
      }

      await doc.ref.set(
        {
          lastSyncedDate: maxDate || end,
          lastRunAt: now,
          lastResult: `${detail.created} novo(s), ${detail.skipped} já existiam.`,
        },
        { merge: true },
      );
    } catch (err) {
      detail.error = (err as Error).message;
      await doc.ref.set(
        { lastRunAt: Date.now(), lastResult: `Erro: ${detail.error}` },
        { merge: true },
      ).catch(() => {});
    }
    outcome.created += detail.created;
    outcome.details.push(detail);
  }

  return outcome;
}
