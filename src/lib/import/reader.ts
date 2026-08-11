// Read an uploaded spreadsheet (CSV / XLS / XLSX) into raw rows.
//
// Runs in the browser. CSV is parsed with PapaParse (robust delimiter and
// quote handling, good for Brazilian `;`-separated files); XLS/XLSX with
// SheetJS. No data leaves the browser at this stage.

import Papa from "papaparse";
import type { RawRow } from "./engine";

export interface ReadResult {
  headers: string[];
  rows: RawRow[];
}

/** Detect the file kind from its name. */
function isCsv(name: string): boolean {
  return /\.csv$/i.test(name) || /\.txt$/i.test(name);
}

/**
 * Format a spreadsheet Date cell as YYYY-MM-DD using its LOCAL calendar
 * fields. `toISOString()` converts to UTC first, which can shift the day for
 * timezone-affected Date objects (the same class of bug as the Cora dates).
 */
function localIsoDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Read a File into headers + row objects keyed by header. */
export async function readSpreadsheet(file: File): Promise<ReadResult> {
  if (isCsv(file.name)) return readCsv(file);
  return readXlsx(file);
}

async function readCsv(file: File): Promise<ReadResult> {
  const text = await file.text();
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    delimiter: "", // auto-detect (handles "," and ";")
    transformHeader: (h) => h.trim(),
  });
  const headers = (parsed.meta.fields ?? []).map((h) => h.trim());
  const rows = (parsed.data as RawRow[]).filter((r) =>
    Object.values(r).some((v) => v != null && String(v).trim() !== ""),
  );
  return { headers, rows };
}

async function readXlsx(file: File): Promise<ReadResult> {
  const buffer = await file.arrayBuffer();
  const XLSX = await import("xlsx"); // sob demanda: só pesa ao ler o arquivo
  const wb = XLSX.read(buffer, { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { headers: [], rows: [] };

  // Read as a matrix first so we can capture the header row exactly.
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: "",
    blankrows: false,
  });
  if (matrix.length === 0) return { headers: [], rows: [] };

  const headers = (matrix[0] as unknown[]).map((h) => String(h ?? "").trim());
  const rows: RawRow[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const cells = matrix[i] as unknown[];
    if (!cells || cells.every((c) => c == null || String(c).trim() === "")) continue;
    const row: RawRow = {};
    headers.forEach((h, idx) => {
      const cell = cells[idx];
      row[h] = cell instanceof Date ? localIsoDate(cell) : cell;
    });
    rows.push(row);
  }
  return { headers, rows };
}
