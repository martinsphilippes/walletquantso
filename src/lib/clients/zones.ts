// WalletQuantso — importação da tabela de bairros de um cliente (lógica pura).
//
// Recebe a planilha como matriz de células (linhas × colunas) e extrai pares
// bairro + preço: o nome é a primeira célula com texto da linha e o preço a
// primeira célula numérica depois dele (aceita "8", "8,50", "R$ 1.234,56" ou
// célula numérica do Excel). Linhas de cabeçalho ("Bairro | Valor") são
// puladas naturalmente porque não têm preço numérico.

import { parseBrCurrency } from "@/lib/br/parse";

export interface ParsedZone {
  name: string;
  price: number;
}

export interface ZoneImportResult {
  zones: ParsedZone[];
  /** Linhas não vazias que não geraram bairro (sem nome ou sem preço válido). */
  skipped: number;
}

/** Texto que é apenas número/moeda (não serve como nome de bairro). */
function looksNumeric(s: string): boolean {
  return /^[R$\s\d.,-]+$/.test(s) && /\d/.test(s);
}

export function zonesFromMatrix(matrix: unknown[][]): ZoneImportResult {
  const zones: ParsedZone[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  for (const row of matrix) {
    if (!row) continue;
    let name = "";
    let price: number | null = null;

    for (const cell of row) {
      const s = String(cell ?? "").trim();
      if (!s) continue;
      if (!name && typeof cell !== "number" && !looksNumeric(s)) {
        name = s;
        continue;
      }
      if (name && price == null) {
        const n = typeof cell === "number" ? cell : parseBrCurrency(s);
        if (n != null && n > 0) {
          price = Math.round(n * 100) / 100;
          break;
        }
      }
    }

    const hasContent = row.some((c) => String(c ?? "").trim() !== "");
    if (!name || price == null) {
      if (hasContent) skipped++;
      continue;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    zones.push({ name, price });
  }

  return { zones, skipped };
}
