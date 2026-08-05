import { describe, it, expect } from "vitest";
import { dateBr } from "./date";

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
