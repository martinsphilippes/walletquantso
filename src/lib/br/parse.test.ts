import { describe, it, expect } from "vitest";
import { parseBrDate, parseBrCurrency } from "./parse";

describe("parseBrDate", () => {
  it("parses dd/mm/yyyy", () => {
    expect(parseBrDate("31/12/2025")).toBe("2025-12-31");
    expect(parseBrDate("01/02/2024")).toBe("2024-02-01");
  });

  it("accepts - and . separators", () => {
    expect(parseBrDate("31-12-2025")).toBe("2025-12-31");
    expect(parseBrDate("31.12.2025")).toBe("2025-12-31");
  });

  it("normalizes 2-digit years", () => {
    expect(parseBrDate("05/06/24")).toBe("2024-06-05");
    expect(parseBrDate("05/06/85")).toBe("1985-06-05");
  });

  it("strips trailing time", () => {
    expect(parseBrDate("15/03/2025 14:30")).toBe("2025-03-15");
  });

  it("accepts already-ISO input", () => {
    expect(parseBrDate("2025-12-31")).toBe("2025-12-31");
  });

  it("converts Excel serial dates", () => {
    // 45658 = 2025-01-01 (Excel epoch 1899-12-30)
    expect(parseBrDate(45658)).toBe("2025-01-01");
  });

  it("rejects impossible dates", () => {
    expect(parseBrDate("31/02/2025")).toBeNull();
    expect(parseBrDate("00/12/2025")).toBeNull();
    expect(parseBrDate("32/01/2025")).toBeNull();
  });

  it("rejects junk", () => {
    expect(parseBrDate("")).toBeNull();
    expect(parseBrDate("abc")).toBeNull();
    expect(parseBrDate(null)).toBeNull();
  });
});

describe("parseBrCurrency", () => {
  it("parses BR grouped decimals", () => {
    expect(parseBrCurrency("1.234,56")).toBe(1234.56);
    expect(parseBrCurrency("1.234.567,89")).toBe(1234567.89);
    expect(parseBrCurrency("R$ 1.234,56")).toBe(1234.56);
  });

  it("parses simple comma decimals", () => {
    expect(parseBrCurrency("1234,56")).toBe(1234.56);
    expect(parseBrCurrency("0,50")).toBe(0.5);
  });

  it("handles negatives and accounting parentheses", () => {
    expect(parseBrCurrency("-1.234,56")).toBe(-1234.56);
    expect(parseBrCurrency("(1.234,56)")).toBe(-1234.56);
    expect(parseBrCurrency("R$ -50,00")).toBe(-50);
  });

  it("treats lone dot as thousands when grouped", () => {
    expect(parseBrCurrency("1.234")).toBe(1234);
    expect(parseBrCurrency("1.234.567")).toBe(1234567);
  });

  it("treats lone dot as decimal when not grouped", () => {
    expect(parseBrCurrency("1234.56")).toBe(1234.56);
  });

  it("passes through numbers", () => {
    expect(parseBrCurrency(42)).toBe(42);
    expect(parseBrCurrency(-3.5)).toBe(-3.5);
  });

  it("rejects junk", () => {
    expect(parseBrCurrency("")).toBeNull();
    expect(parseBrCurrency("abc")).toBeNull();
    expect(parseBrCurrency(null)).toBeNull();
  });
});
