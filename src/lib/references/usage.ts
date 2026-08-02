// WalletQuantso — reference usage counting (pure).
//
// Counts how many transactions reference each id under a given field
// (e.g. costCenterId, contactId). The UI uses this to show usage at a glance
// and to warn before deleting a record that is still in use.

/** Map of id -> number of transactions referencing it under `field`. */
export function countReferences<K extends string>(
  txs: Array<Partial<Record<K, string | null | undefined>>>,
  field: K,
): Map<string, number> {
  const usage = new Map<string, number>();
  for (const t of txs) {
    const id = t[field];
    if (!id) continue;
    usage.set(id, (usage.get(id) ?? 0) + 1);
  }
  return usage;
}
