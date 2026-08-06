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

/**
 * A category or subcategory. Hierarchy: cost center → category → subcategory.
 * A top-level category (parentId null) must belong to a cost center; a
 * subcategory points to its parent category and inherits its cost center.
 */
export interface Category {
  id?: string;
  ownerId: string;
  name: string;
  /** Which type of transaction this category applies to. */
  kind: TransactionType;
  /** Parent category id when this is a subcategory; null for top-level. */
  parentId: string | null;
  /** Cost center a top-level category belongs to (subcategories inherit it). */
  costCenterId?: string | null;
  createdAt: number;
}

/** Bairro com preço de entrega pré-definido (tabela de um cliente). */
export interface DeliveryZone {
  id: string;
  name: string;
  price: number;
}

/**
 * Cliente do negócio de entregas, com as regras de cobrança dele. Qualquer
 * combinação pode estar ativa ao mesmo tempo:
 *  • diária  — um motoboy disponível em um turno (manhã/tarde), valor fixo;
 *  • entrega — preço por bairro, conforme a tabela `zones`;
 *  • percentual — % sobre o faturamento entregue (ex.: fábrica paga 12%).
 * Os vínculos padrão preenchem o título a receber gerado.
 */
export interface Client {
  id?: string;
  ownerId: string;
  name: string;
  /** Valor de UMA diária (um motoboy em um turno). null = não cobra diária. */
  dailyRate?: number | null;
  /** Percentual sobre o faturamento entregue (ex.: 12 = 12%). */
  revenuePercent?: number | null;
  /** Tabela de bairros para cobrança por entrega. */
  zones?: DeliveryZone[];
  contactId?: string | null;
  accountId?: string | null;
  categoryId?: string | null;
  costCenterId?: string | null;
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

/** Whether a bill is money to pay out or to receive. */
export type BillKind = "payable" | "receivable";

/** A single (possibly partial) settlement of a bill. */
export interface BillPayment {
  /** Client-generated id, unique within the bill. */
  id: string;
  /** ISO date the payment happened (YYYY-MM-DD). */
  date: string;
  /** Positive amount settled in this payment, in BRL. */
  amount: number;
  /** Account the money moved through (optional). */
  accountId?: string | null;
  /**
   * Id of the ledger transaction materialized for this settlement, so the
   * baixa shows up in Lançamentos and account balances. When set, dashboard
   * math takes the cash from that transaction instead of the payment (no double
   * counting). Older payments made before this feature have it unset.
   */
  transactionId?: string | null;
}

/**
 * A payable or receivable (conta a pagar / a receber): a planned obligation
 * with a due date, settled by one or more (possibly partial) payments.
 */
export interface Bill {
  id?: string;
  ownerId: string;
  kind: BillKind;
  description: string;
  /** Total planned amount, in BRL. */
  amount: number;
  /** Due date as an ISO date string (YYYY-MM-DD). */
  dueDate: string;
  /** Accrual / competence date (YYYY-MM-DD); defaults to the due date. */
  competenceDate?: string | null;
  /** Free-text document number (nota, boleto, etc.). */
  documentNumber?: string | null;
  categoryId?: string | null;
  costCenterId?: string | null;
  contactId?: string | null;
  /** Expected account for the settlement (optional). */
  accountId?: string | null;
  /** Settlements applied so far. */
  payments: BillPayment[];
  installment?: Installment | null;
  installmentGroupId?: string | null;
  notes?: string | null;
  /** Id of the import batch that created this title (for undo/audit). */
  importBatchId?: string | null;
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
  /** Bank reconciliation flag: the entry has cleared the bank statement. */
  reconciled?: boolean;
  /** For transfers: the destination account. */
  transferAccountId?: string | null;
  installment?: Installment | null;
  /** Groups the installments of a single purchase into one series. */
  installmentGroupId?: string | null;
  /** When this entry was materialized from a bill settlement (baixa). */
  billId?: string | null;
  /** The specific BillPayment this entry settles (links back to the bill). */
  billPaymentId?: string | null;
  tags?: string[];
  /** Id of the import batch that created this record (for undo/audit). */
  importBatchId?: string | null;
  /**
   * Stable external id when this entry mirrors a record from an outside system
   * (e.g. a Cora bank statement entry: "cora:ent_..."). Used to avoid importing
   * the same bank movement twice on repeated syncs.
   */
  externalId?: string | null;
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
  | "contact"
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

/**
 * Per-owner configuration for the scheduled Cora auto-sync. Document id is the
 * owner uid. Managed from the app; read/written by the scheduled job (Admin).
 */
export interface CoraSyncConfig {
  ownerId: string;
  /** When true, the scheduled job imports new movements for this owner. */
  enabled: boolean;
  /** Account the imported lançamentos are attributed to. */
  accountId: string;
  /** ISO date (YYYY-MM-DD) of the latest movement already imported. */
  lastSyncedDate?: string | null;
  /** Timestamp of the last successful run. */
  lastRunAt?: number | null;
  /** Last run's outcome message (for display/debug). */
  lastResult?: string | null;
  updatedAt: number;
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
