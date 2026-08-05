import { describe, it, expect } from "vitest";
import { dateBr, monthRangeBr } from "./date";

describe("dateBr", () => {
  it("keeps a Brazilian evening on its local day (UTC already flipped)", () => {
    // 28/07 21:30 in Brazil = 29/07 00:30 UTC.
    expect(dateBr(new Date("2026-07-29T00:30:00Z"))).toBe("2026-07-28");
  });

  it("matches the UTC date during the Brazilian daytime", () => {
    // 09:00 UTC = 06:00 in Brazil, same calendar day.
    expect(dateBr(new Date("2026-04-06T09:00:00Z"))).toBe("2026-04-06");
  });

  it("handles the month boundary at night", () => {
    // 31/07 23:00 in Brazil = 01/08 02:00 UTC — must stay in July.
    expect(dateBr(new Date("2026-08-01T02:00:00Z"))).toBe("2026-07-31");
  });
});

describe("monthRangeBr", () => {
  it("returns first/last day of the current, previous and next month", () => {
    expect(monthRangeBr(0, "2026-08-05")).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(monthRangeBr(-1, "2026-08-05")).toEqual({ from: "2026-07-01", to: "2026-07-31" });
    expect(monthRangeBr(1, "2026-08-05")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("crosses year boundaries and leap Februaries", () => {
    expect(monthRangeBr(-1, "2026-01-10")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(monthRangeBr(1, "2027-12-10")).toEqual({ from: "2028-01-01", to: "2028-01-31" });
    expect(monthRangeBr(0, "2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
});
