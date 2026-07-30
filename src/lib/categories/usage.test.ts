import { describe, it, expect } from "vitest";
import { computeCategoryUsage } from "./usage";

describe("computeCategoryUsage", () => {
  it("counts transactions per category", () => {
    const usage = computeCategoryUsage([
      { categoryId: "a" },
      { categoryId: "a" },
      { categoryId: "b" },
      { categoryId: null },
      {},
    ]);
    expect(usage.get("a")).toBe(2);
    expect(usage.get("b")).toBe(1);
    expect(usage.size).toBe(2);
  });

  it("returns empty for no categorized transactions", () => {
    expect(computeCategoryUsage([{ categoryId: null }, {}]).size).toBe(0);
  });
});
