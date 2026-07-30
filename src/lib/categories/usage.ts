// WalletQuantso — category usage counting (pure).
//
// Counts how many transactions reference each category, so the UI can warn
// before deleting a category that is in use and show usage at a glance.

export interface HasCategory {
  categoryId?: string | null;
}

/** Map of categoryId -> number of transactions using it. */
export function computeCategoryUsage(txs: HasCategory[]): Map<string, number> {
  const usage = new Map<string, number>();
  for (const t of txs) {
    if (!t.categoryId) continue;
    usage.set(t.categoryId, (usage.get(t.categoryId) ?? 0) + 1);
  }
  return usage;
}
