// WalletQuantso — CSV building (pure).
//
// Produces `;`-delimited CSV (the Brazilian Excel default) with correct
// quoting. A UTF-8 BOM is added at download time so accents survive in Excel.

import type { Transaction, TransactionType } from "@/types";

const TYPE_LABELS: Record<TransactionType, string> = {
  income: "Receita",
  expense: "Despesa",
  transfer: "Transferência",
};

function cell(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Join a matrix of values into a CSV string (CRLF rows, `;` columns). */
export function toCsv(rows: (string | number | null | undefined)[][], delimiter = ";"): string {
  return rows.map((r) => r.map(cell).join(delimiter)).join("\r\n");
}

/** Brazilian decimal string, e.g. 12.2 -> "12,20". */
export function brNumber(n: number): string {
  return n.toFixed(2).replace(".", ",");
}

/** ISO date (YYYY-MM-DD) -> dd/mm/aaaa. */
export function brDate(iso: string): string {
  const parts = iso.split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : iso;
}

export interface NameLookup {
  account: (id?: string | null) => string;
  category: (id?: string | null) => string;
  /** Optional cost center name lookup; column is added when provided. */
  costCenter?: (id?: string | null) => string;
  /** Optional contact name lookup; column is added when provided. */
  contact?: (id?: string | null) => string;
}

/** Build the CSV matrix (header + rows) for a list of transactions. */
export function transactionsToCsv(txs: Transaction[], names: NameLookup): string {
  const hasCostCenter = typeof names.costCenter === "function";
  const hasContact = typeof names.contact === "function";
  const header = [
    "Data",
    "Descrição",
    "Tipo",
    "Categoria",
    ...(hasCostCenter ? ["Centro de custo"] : []),
    ...(hasContact ? ["Pessoa/contato"] : []),
    "Conta",
    "Conta destino",
    "Valor",
    "Observações",
  ];
  const rows = txs.map((t) => [
    brDate(t.date),
    t.description,
    TYPE_LABELS[t.type],
    names.category(t.categoryId),
    ...(hasCostCenter ? [names.costCenter!(t.costCenterId)] : []),
    ...(hasContact ? [names.contact!(t.contactId)] : []),
    names.account(t.accountId),
    t.type === "transfer" ? names.account(t.transferAccountId) : "",
    // Signed value: expenses negative, income/transfer positive.
    (t.type === "expense" ? "-" : "") + brNumber(t.amount),
    t.notes ?? "",
  ]);
  return toCsv([header, ...rows]);
}
