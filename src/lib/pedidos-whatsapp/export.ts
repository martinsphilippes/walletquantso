// Builds and downloads the .xlsx for a parsed WhatsApp conversation.
// Runs entirely in the browser; nothing is uploaded anywhere.

import * as XLSX from "xlsx";
import { COLUMNS, rowValues, type ParsedRow } from "./parser";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function buildWorkbook(rows: ParsedRow[]): XLSX.WorkBook {
  const data = [Array.from(COLUMNS), ...rows.map(rowValues)];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = [{ wch: 14 }, { wch: 12 }, { wch: 26 }, { wch: 18 }, { wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Cotações");
  return wb;
}

export function pedidosWhatsAppFilename(now: Date = new Date()): string {
  return (
    "pedidos_" +
    now.getFullYear() +
    "-" +
    pad(now.getMonth() + 1) +
    "-" +
    pad(now.getDate()) +
    "_" +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    ".xlsx"
  );
}

export function downloadWorkbook(rows: ParsedRow[]): void {
  const wb = buildWorkbook(rows);
  XLSX.writeFile(wb, pedidosWhatsAppFilename());
}

export function previewToText(rows: ParsedRow[]): string {
  const lines = [COLUMNS.join("\t"), ...rows.map((r) => rowValues(r).join("\t"))];
  return lines.join("\n");
}
