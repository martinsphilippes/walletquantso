// WalletQuantso — import engine (pure logic).
//
// This module turns raw spreadsheet rows into validated, normalized
// transactions. It performs NO I/O and NO Firestore writes — persistence,
// preview/commit and undo live in the service layer. Keeping this pure makes
// the risky parts (locale parsing, classification, dedup) unit-testable.

import type {
  CanonicalField,
  ColumnMapping,
  Transaction,
  TransactionType,
} from "@/types";
import { parseBrCurrency, parseBrDate } from "@/lib/br/parse";

/** A raw row keyed by the original spreadsheet header. */
export type RawRow = Record<string, unknown>;

/** Header-detection keywords per canonical field (accent-insensitive). */
// Keyword lists tuned to the official Meu Dinheiro export layout:
//   Data, Valor, Descrição, Conta, Conta Transferência, Cartão, Categoria,
//   Subcategoria, Contato, Centro, Projeto, Forma, N. Documento, Observações,
//   Data Competência, Tags
const FIELD_KEYWORDS: Record<CanonicalField, string[]> = {
  date: ["data", "date", "dia", "vencimento"],
  description: ["descricao", "descrição", "historico", "histórico", "memo", "titulo", "título"],
  amount: ["valor", "amount", "quantia", "montante", "total"],
  type: ["tipo", "type", "natureza", "receita/despesa", "d/c"],
  account: ["conta", "account", "banco", "carteira"],
  card: ["cartao", "cartão"],
  category: ["categoria", "category"],
  subcategory: ["subcategoria", "sub-categoria", "subcategory"],
  costCenter: ["centro de custo", "centro", "projeto", "cost center"],
  notes: ["observacoes", "observações", "observacao", "observação", "obs", "notas", "nota", "comentario", "comentário"],
  installment: ["parcela", "parcelamento", "installment"],
  tags: ["tag", "tags", "etiqueta", "etiquetas"],
  transferAccount: ["conta transferencia", "conta transferência", "conta destino", "destino", "transferencia", "transferência"],
};

/** Remove accents and lowercase, for tolerant header matching. */
export function normalizeHeader(h: string): string {
  return h
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Best-effort automatic mapping of spreadsheet headers to canonical fields.
 * A field is only assigned once (first matching header wins), and unmatched
 * headers map to null so the user can map them manually.
 */
export function detectColumns(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<CanonicalField>();

  for (const header of headers) {
    const norm = normalizeHeader(header);
    let matched: CanonicalField | null = null;

    for (const field of Object.keys(FIELD_KEYWORDS) as CanonicalField[]) {
      if (used.has(field)) continue;
      const keywords = FIELD_KEYWORDS[field];
      // Prefer exact match, then substring.
      if (keywords.some((k) => norm === normalizeHeader(k))) {
        matched = field;
        break;
      }
    }
    if (!matched) {
      for (const field of Object.keys(FIELD_KEYWORDS) as CanonicalField[]) {
        if (used.has(field)) continue;
        if (FIELD_KEYWORDS[field].some((k) => norm.includes(normalizeHeader(k)))) {
          matched = field;
          break;
        }
      }
    }

    mapping[header] = matched;
    if (matched) used.add(matched);
  }

  return mapping;
}

/** Invert a mapping to look up the source header for a canonical field. */
function headerFor(mapping: ColumnMapping, field: CanonicalField): string | undefined {
  return Object.keys(mapping).find((h) => mapping[h] === field);
}

/**
 * Classify a row as income / expense / transfer.
 *
 * Priority:
 *  1. An explicit "type" column (receita/despesa/transferência, C/D, +/-).
 *  2. A destination-account column present => transfer.
 *  3. Sign of the amount: negative => expense, positive => income.
 */
export function classify(
  typeText: string | undefined,
  amount: number,
  hasTransferAccount: boolean,
): TransactionType {
  if (typeText) {
    const t = normalizeHeader(typeText);
    if (/(transfer|transferencia)/.test(t)) return "transfer";
    if (/(receita|entrada|credito|credit|income|^c$|^\+)/.test(t)) return "income";
    if (/(despesa|saida|debito|debit|expense|^d$|^-)/.test(t)) return "expense";
  }
  if (hasTransferAccount) return "transfer";
  return amount < 0 ? "expense" : "income";
}

/**
 * Stable duplicate-detection hash from the natural key of a transaction.
 * Two rows with the same date, absolute amount, normalized description and
 * account are considered the same entry. Synchronous and deterministic (djb2)
 * so it works identically on client and server without async crypto.
 */
export function dedupHash(parts: {
  date: string;
  amount: number;
  description: string;
  account: string;
}): string {
  const key = [
    parts.date,
    Math.round(Math.abs(parts.amount) * 100),
    normalizeHeader(parts.description),
    normalizeHeader(parts.account),
  ].join("|");
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash + key.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Outcome of normalizing a single raw row. */
export interface NormalizedRow {
  /** 1-based row number in the source (for error reporting). */
  rowNumber: number;
  /** The transaction to be created, minus persistence-only fields. */
  transaction: Omit<Transaction, "ownerId" | "createdAt" | "importBatchId"> | null;
  /** Blocking problems that prevent import of this row. */
  errors: string[];
  /** Non-blocking notices (e.g. "will be created as a new account"). */
  warnings: string[];
}

/** Parse an installment string like "3/12" into structured data. */
export function parseInstallment(text: string | undefined) {
  if (!text) return null;
  const m = String(text).match(/(\d+)\s*\/\s*(\d+)/);
  if (!m) return null;
  const number = Number(m[1]);
  const total = Number(m[2]);
  if (number < 1 || total < 1 || number > total) return null;
  return { number, total };
}

/**
 * Normalize + validate one raw row against a column mapping. Pure: returns the
 * candidate transaction plus per-row errors/warnings. Never throws.
 */
export function normalizeRow(row: RawRow, mapping: ColumnMapping, rowNumber: number): NormalizedRow {
  const errors: string[] = [];
  const warnings: string[] = [];

  const get = (field: CanonicalField): string | undefined => {
    const header = headerFor(mapping, field);
    if (!header) return undefined;
    const v = row[header];
    return v == null ? undefined : String(v).trim();
  };

  const rawDate = mapping[headerFor(mapping, "date") ?? ""] === "date"
    ? row[headerFor(mapping, "date") as string]
    : undefined;
  const rawAmount = headerFor(mapping, "amount")
    ? row[headerFor(mapping, "amount") as string]
    : undefined;

  const date = parseBrDate(rawDate);
  if (!headerFor(mapping, "date")) errors.push("Coluna de data não mapeada.");
  else if (date == null) errors.push(`Data inválida: "${String(rawDate ?? "")}".`);

  const amount = parseBrCurrency(rawAmount);
  if (!headerFor(mapping, "amount")) errors.push("Coluna de valor não mapeada.");
  else if (amount == null) errors.push(`Valor inválido: "${String(rawAmount ?? "")}".`);

  const description = get("description") ?? "";
  if (!description) warnings.push("Descrição vazia.");

  // Meu Dinheiro uses a separate "Cartão" column for card transactions, where
  // "Conta" is left blank. Fall back to the card as the account in that case.
  const account = get("account") || get("card") || "";
  if (!account) errors.push("Conta não informada.");

  const transferAccount = get("transferAccount");
  const type = classify(get("type"), amount ?? 0, Boolean(transferAccount));
  const installment = parseInstallment(get("installment"));

  if (errors.length || date == null || amount == null) {
    return { rowNumber, transaction: null, errors, warnings };
  }

  const tagsText = get("tags");
  const tags = tagsText
    ? tagsText.split(/[;,]/).map((t) => t.trim()).filter(Boolean)
    : undefined;

  return {
    rowNumber,
    transaction: {
      date,
      amount: Math.abs(amount),
      type,
      description,
      notes: get("notes") || undefined,
      accountId: account, // resolved to a real id later, in the service layer
      categoryId: get("category") || null,
      costCenterId: get("costCenter") || null,
      transferAccountId: transferAccount || null,
      installment,
      tags,
      dedupHash: dedupHash({ date, amount, description, account }),
    },
    errors,
    warnings,
  };
}

/** Aggregate result of normalizing a whole file. */
export interface PreviewResult {
  rows: NormalizedRow[];
  /** Rows that are importable (no errors). */
  importable: NormalizedRow[];
  /** Rows rejected due to errors. */
  rejected: NormalizedRow[];
  /** Importable rows that duplicate another importable row in the same file. */
  duplicatesInFile: NormalizedRow[];
}

/** Build a full preview from raw rows + mapping. Pure and side-effect free. */
export function buildPreview(rows: RawRow[], mapping: ColumnMapping): PreviewResult {
  const normalized = rows.map((r, i) => normalizeRow(r, mapping, i + 1));
  const importable = normalized.filter((r) => r.transaction && r.errors.length === 0);
  const rejected = normalized.filter((r) => r.errors.length > 0);

  const seen = new Set<string>();
  const duplicatesInFile: NormalizedRow[] = [];
  for (const r of importable) {
    const h = r.transaction!.dedupHash;
    if (seen.has(h)) duplicatesInFile.push(r);
    else seen.add(h);
  }

  return { rows: normalized, importable, rejected, duplicatesInFile };
}
