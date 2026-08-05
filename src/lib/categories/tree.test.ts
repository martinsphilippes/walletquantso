import { describe, it, expect } from "vitest";
import { effectiveCostCenterId, categoryOptions } from "./tree";
import type { Category } from "@/types";

function cat(id: string, name: string, extra: Partial<Category> = {}): Category {
  return { id, ownerId: "u1", name, kind: "expense", parentId: null, createdAt: 0, ...extra };
}

describe("effectiveCostCenterId", () => {
  const parent = cat("p1", "Familia", { costCenterId: "cc1" });
  const sub = cat("s1", "Escola", { parentId: "p1" });
  const byId = new Map([
    ["p1", parent],
    ["s1", sub],
  ]);

  it("returns the category's own cost center", () => {
    expect(effectiveCostCenterId(parent, byId)).toBe("cc1");
  });

  it("inherits the parent's cost center for a subcategory", () => {
    expect(effectiveCostCenterId(sub, byId)).toBe("cc1");
  });

  it("returns null for missing category or unset center", () => {
    expect(effectiveCostCenterId(undefined, byId)).toBeNull();
    expect(effectiveCostCenterId(cat("x", "Solta"), byId)).toBeNull();
  });
});

describe("categoryOptions", () => {
  it("orders parents alphabetically with their subs right after, labeled Pai › Sub", () => {
    const opts = categoryOptions([
      cat("b", "Loja", { costCenterId: "cc2" }),
      cat("a", "Familia", { costCenterId: "cc1" }),
      cat("s2", "Mercado", { parentId: "a" }),
      cat("s1", "Escola", { parentId: "a" }),
    ]);
    expect(opts.map((o) => o.label)).toEqual([
      "Familia",
      "Familia › Escola",
      "Familia › Mercado",
      "Loja",
    ]);
    expect(opts[1].isSub).toBe(true);
    expect(opts[0].isSub).toBe(false);
  });

  it("keeps orphan subs (parent gone) at the end instead of dropping them", () => {
    const opts = categoryOptions([cat("a", "Familia"), cat("s1", "Perdida", { parentId: "zzz" })]);
    expect(opts.map((o) => o.id)).toEqual(["a", "s1"]);
  });
});
