// Brazilian-locale parsing helpers.
//
// These are pure functions with no side effects so they can be unit-tested in
// isolation. They are deliberately strict: an unrecognized input returns
// `null` rather than guessing, so the importer can flag the row as an error
// instead of silently storing garbage.

/**
 * Parse a Brazilian-format date into an ISO date string (YYYY-MM-DD).
 *
 * Accepts separators `/`, `-` or `.` and 2- or 4-digit years:
 *   "31/12/2025", "31-12-2025", "31.12.25"
 * Also accepts an already-ISO string ("2025-12-31") and Excel serial dates
 * (numbers), which SheetJS may hand us when a cell is a real date.
 *
 * Returns null when the value is not a valid, real calendar date.
 */
export function parseBrDate(input: unknown): string | null {
  if (input == null) return null;

  // Excel serial date (days since 1899-12-30).
  if (typeof input === "number" && Number.isFinite(input)) {
    return excelSerialToIso(input);
  }

  const raw = String(input).trim();
  if (!raw) return null;

  // Already ISO (YYYY-MM-DD, optionally with time).
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (iso) {
    return buildIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  // Brazilian dd/mm/yyyy (also strips a trailing time like " 14:30").
  const br = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})(?:[T\s].*)?$/);
  if (br) {
    const day = Number(br[1]);
    const month = Number(br[2]);
    const year = normalizeYear(Number(br[3]));
    return buildIso(year, month, day);
  }

  return null;
}

function normalizeYear(year: number): number {
  if (year >= 100) return year;
  // Two-digit year: assume 2000s for <= 69, 1900s otherwise (common pivot).
  return year <= 69 ? 2000 + year : 1900 + year;
}

/** Build an ISO date string, validating it is a real calendar date. */
function buildIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  // Reject overflow like 31/02 (JS would roll over to March).
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function excelSerialToIso(serial: number): string | null {
  // Excel's epoch is 1899-12-30 (accounting for the 1900 leap-year bug).
  const ms = Math.round(serial) * 86400000;
  const d = new Date(Date.UTC(1899, 11, 30) + ms);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

/**
 * Parse a Brazilian-format monetary value into a number.
 *
 * Handles: "R$ 1.234,56", "1.234,56", "-1.234,56", "(1.234,56)" (accounting
 * negative), "1234,56", plain "1234.56", and numeric inputs.
 *
 * `.` is treated as a thousands separator and `,` as the decimal separator —
 * the Brazilian convention. Returns null when no numeric value is present.
 */
export function parseBrCurrency(input: unknown): number | null {
  if (input == null) return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : null;

  let raw = String(input).trim();
  if (!raw) return null;

  // Accounting negatives: (1.234,56) => -1234.56
  let negative = false;
  if (/^\(.*\)$/.test(raw)) {
    negative = true;
    raw = raw.slice(1, -1).trim();
  }

  // Strip currency symbols/spaces and NBSP.
  raw = raw.replace(/r\$/gi, "").replace(/ /g, " ").trim();

  if (raw.startsWith("-")) {
    negative = true;
    raw = raw.slice(1).trim();
  } else if (raw.startsWith("+")) {
    raw = raw.slice(1).trim();
  }

  // Keep only digits, dots and commas.
  raw = raw.replace(/[^\d.,]/g, "");
  if (!raw || !/\d/.test(raw)) return null;

  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");

  let normalized: string;
  if (hasComma && hasDot) {
    // Brazilian: dot = thousands, comma = decimal.
    normalized = raw.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    // Only comma present => decimal separator.
    normalized = raw.replace(",", ".");
  } else if (hasDot) {
    // Only dot(s). If it looks like a thousands grouping ("1.234" or
    // "1.234.567"), strip; otherwise treat as a decimal point.
    if (/^\d{1,3}(\.\d{3})+$/.test(raw)) {
      normalized = raw.replace(/\./g, "");
    } else {
      normalized = raw;
    }
  } else {
    normalized = raw;
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}
