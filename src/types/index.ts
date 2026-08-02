// WalletQuantso — domain model.
//
// A personal finance system. These types describe the entities persisted in
// Firestore. All records are scoped to a single owner (`ownerId`) so that
// security rules can isolate each user's data.

/** Kind of money movement. */
export type TransactionType = "income" | "expense" | "transfer";

/** Kind of account / where money lives. */
export type AccountType =
  | "checking" // conta corrente
  | "savings" // poupança
  | "credit_card" // cartão de crédito
  | "cash" // dinheiro
  | "investment" // investimento
  | "other";

/** A bank account, wallet, or credit card. */
export interface Account {
  id?: string;
  ownerId: string;
  name: string;
  type: AccountType;
  /** Opening balance used as the starting point of the ledger, in BRL. */
  initialBalance: number;
  currency: string; // e.g. "BRL"
  archived: boolean;
  createdAt: number;
}

/** A category or subcategory (subcategory has a `parentId`). */
export interface Category {
  id?: string;
  ownerId: string;
  name: string;
  /** Which type of transaction this category applies to. */
  kind: TransactionType;
  /** Parent category id when this is a subcategory; null for top-level. */
  parentId: string | null;
  createdAt: number;
}

/** A cost center / project (centro de custo / projeto). */
export interface CostCenter {
  id?: string;
  ownerId: string;
  name: string;
  createdAt: number;
}

/** Kind of contact / counterpart. */
export type ContactKind =
  | "person" // pessoa física
  | "supplier" // fornecedor
  | "customer" // cliente
  | "company" // empresa (genérica)
  | "other";

/**
 * A person or company involved in a transaction (contato / fornecedor).
 * Maps to the "Contato" column of Meu Dinheiro Web.
 */
export interface Contact {
  id?: string;
  ownerId: string;
  name: string;
  kind: ContactKind;
  /** CPF/CNPJ or other identifier (optional, free text). */
  document?: string | null;
  notes?: string | null;
  createdAt: number;
}

/** Installment metadata for a transaction that is part of a series. */
export interface Installment {
  /** 1-based position, e.g. 3. */
  number: number;
  /** Total count, e.g. 12. */
  total: number;
}

/** A single ledger entry (lançamento). */
export interface Transaction {
  id?: string;
  ownerId: string;
  /** Transaction date as an ISO date string (YYYY-MM-DD). */
  date: string;
  /** Absolute amount in BRL (always positive; direction comes from `type`). */
  amount: number;
  type: TransactionType;
  description: string;
  notes?: string;
  accountId: string;
  categoryId?: string | null;
  costCenterId?: string | null;
  /** The person/company involved (contato / fornecedor). */
  contactId?: string | null;
  /** For transfers: the destination account. */
  transferAccountId?: string | null;
  installment?: Installment | null;
  /** Groups the installments of a single purchase into one series. */
  installmentGroupId?: string | null;
  tags?: string[];
  /** Id of the import batch that created this record (for undo/audit). */
  importBatchId?: string | null;
  /** Stable hash of natural key fields, used for duplicate detection. */
  dedupHash: string;
  createdAt: number;
}

/** Lifecycle of an import batch. */
export type ImportStatus = "preview" | "committed" | "reverted";

/** A mapping from a spreadsheet column header to a canonical field. */
export type ColumnMapping = Record<string, CanonicalField | null>;

/** Canonical fields the importer understands. */
export type CanonicalField =
  | "date"
  | "description"
  | "amount"
  | "type"
  | "account"
  | "card"
  | "category"
  | "subcategory"
  | "costCenter"
  | "notes"
  | "installment"
  | "tags"
  | "transferAccount";

/** An import run — created in `preview` before anything is committed. */
export interface ImportBatch {
  id?: string;
  ownerId: string;
  sourceFileName: string;
  status: ImportStatus;
  mapping: ColumnMapping;
  counts: {
    total: number;
    imported: number;
    ignored: number;
    rejected: number;
  };
  createdAt: number;
  committedAt?: number | null;
  revertedAt?: number | null;
}

/** Append-only audit record. */
export interface AuditEntry {
  id?: string;
  ownerId: string;
  action:
    | "import_preview"
    | "import_commit"
    | "import_revert"
    | "manual_create"
    | "manual_update"
    | "manual_delete";
  importBatchId?: string | null;
  details: Record<string, unknown>;
  at: number;
}
