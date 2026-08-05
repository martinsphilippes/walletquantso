// WalletQuantso — category hierarchy helpers (pure logic).
//
// The hierarchy is: cost center → category → subcategory. A top-level
// category carries its own `costCenterId`; a subcategory inherits the cost
// center from its parent. These helpers resolve that inheritance and build
// ordered option lists for the selects (parent first, its subs indented).

import type { Category } from "@/types";

/** Cost center a category effectively belongs to (own, or the parent's). */
export function effectiveCostCenterId(
  cat: Category | undefined,
  byId: Map<string, Category>,
): string | null {
  if (!cat) return null;
  if (cat.costCenterId) return cat.costCenterId;
  if (cat.parentId) return byId.get(cat.parentId)?.costCenterId ?? null;
  return null;
}

export interface CategoryOption {
  id: string;
  /** "Sub" is labeled "Pai › Sub" so the hierarchy reads in flat selects. */
  label: string;
  isSub: boolean;
}

/**
 * Flat option list ordered as a tree: each top-level category followed by its
 * subcategories. Orphan subs (parent deleted/filtered out) come last, still
 * labeled with the parent name when known.
 */
export function categoryOptions(cats: Category[]): CategoryOption[] {
  const byId = new Map(cats.filter((c) => c.id).map((c) => [c.id as string, c]));
  const tops = cats
    .filter((c) => !c.parentId && c.id)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const subsOf = new Map<string, Category[]>();
  const orphans: Category[] = [];
  for (const c of cats) {
    if (!c.id || !c.parentId) continue;
    if (byId.has(c.parentId)) {
      const list = subsOf.get(c.parentId) ?? [];
      list.push(c);
      subsOf.set(c.parentId, list);
    } else {
      orphans.push(c);
    }
  }

  const out: CategoryOption[] = [];
  for (const t of tops) {
    out.push({ id: t.id!, label: t.name, isSub: false });
    const subs = (subsOf.get(t.id!) ?? []).sort((a, b) =>
      a.name.localeCompare(b.name, "pt-BR"),
    );
    for (const s of subs) out.push({ id: s.id!, label: `${t.name} › ${s.name}`, isSub: true });
  }
  for (const s of orphans.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))) {
    out.push({ id: s.id!, label: s.name, isSub: true });
  }
  return out;
}
