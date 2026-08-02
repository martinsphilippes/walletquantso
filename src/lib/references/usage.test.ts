import { describe, it, expect } from "vitest";
import { countReferences } from "./usage";

describe("countReferences", () => {
  it("counts transactions per id under the given field", () => {
    const txs = [
      { costCenterId: "a" },
      { costCenterId: "a" },
      { costCenterId: "b" },
      { costCenterId: null },
      {},
    ];
    const usage = countReferences(txs, "costCenterId");
    expect(usage.get("a")).toBe(2);
    expect(usage.get("b")).toBe(1);
    expect(usage.size).toBe(2);
  });

  it("ignores null and undefined references", () => {
    const txs = [{ contactId: undefined }, { contactId: null }];
    const usage = countReferences(txs, "contactId");
    expect(usage.size).toBe(0);
  });

  it("returns an empty map for no transactions", () => {
    expect(countReferences([], "costCenterId").size).toBe(0);
  });

  it("counts different fields independently", () => {
    const txs = [
      { costCenterId: "cc1", contactId: "p1" },
      { costCenterId: "cc1", contactId: "p2" },
    ];
    expect(countReferences(txs, "costCenterId").get("cc1")).toBe(2);
    expect(countReferences(txs, "contactId").get("p1")).toBe(1);
    expect(countReferences(txs, "contactId").get("p2")).toBe(1);
  });
});
