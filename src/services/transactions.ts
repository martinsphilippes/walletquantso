// WalletQuantso — manual transaction CRUD (with audit logging).
//
// Manual entries mirror the shape of imported ones but carry no importBatchId.
// Every create/update/delete appends an append-only audit entry so manual
// changes are traceable alongside imports.

import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { db } from "./firebase";
import { COLLECTIONS, appendAudit } from "./firestore";
import { dedupHash } from "@/lib/import/engine";
import { computeFee, feeApplies, learnedPercent, linkedChargesFor, mainAmount } from "@/lib/fees/fee";
import type { Account, Bill, BillPayment, Transaction, TransactionType } from "@/types";

export interface TransactionInput {
  date: string; // ISO YYYY-MM-DD
  amount: number; // positive; direction comes from `type`
  type: TransactionType;
  description: string;
  accountId: string;
  transferAccountId?: string | null;
  categoryId?: string | null;
  costCenterId?: string | null;
  contactId?: string | null;
  notes?: string;
  /**
   * Taxa da conta (ex.: Depix) decidida no formulário. `amount` = valor
   * LANÇADO (bruto); a taxa vira um lançamento de despesa à parte.
   * `learn`: o usuário corrigiu a taxa → o novo percentual vira o da conta.
   * Ausente (undefined) numa edição = não mexe na taxa já vinculada.
   */
  fee?: { accountId: string; amount: number; learn?: boolean } | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

async function loadAccount(id: string): Promise<Account | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.accounts, id));
  return snap.exists() ? ({ id: snap.id, ...(snap.data() as object) } as Account) : null;
}

/** Lançamento de despesa da taxa, ligado ao lançamento que a originou. */
function buildFeeRecord(
  ownerId: string,
  account: Account,
  amount: number,
  date: string,
  description: string,
  mainId: string,
): Transaction {
  const desc = `Taxa ${account.name}${description ? ` — ${description}` : ""}`;
  return {
    ownerId,
    date,
    amount: round2(Math.abs(amount)),
    type: "expense",
    description: desc,
    accountId: account.id!,
    categoryId: account.fee?.categoryId ?? null,
    transferAccountId: null,
    costCenterId: account.fee?.costCenterId ?? null,
    contactId: null,
    installment: null,
    installmentGroupId: null,
    importBatchId: null,
    billId: null,
    billPaymentId: null,
    feeOfId: mainId,
    notes: `Taxa da conta ${account.name}`,
    dedupHash: dedupHash({ date, amount, description: desc, account: account.id! }),
    createdAt: Date.now(),
  };
}

/** Grava o percentual aprendido na conta (quando o usuário corrigiu a taxa). */
async function learnFee(account: Account, gross: number, fee: number): Promise<void> {
  if (!account.fee) return;
  const percent = learnedPercent(gross, fee, account.fee.fixed ?? 0);
  if (Math.abs(percent - (account.fee.percent ?? 0)) < 0.00005) return;
  await updateDoc(doc(db, COLLECTIONS.accounts, account.id!), {
    fee: { ...account.fee, percent, updatedAt: Date.now() },
  });
}

/** Contas do dono (para as regras vinculadas). */
async function loadAccounts(ownerId: string): Promise<Account[]> {
  const snap = await getDocs(query(collection(db, COLLECTIONS.accounts), where("ownerId", "==", ownerId)));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as Account);
}

/**
 * Regras vinculadas: usar uma conta gera despesas em OUTRAS contas (ex.:
 * Depix → L-BTC). Cria um lançamento por regra, ligado ao principal, e
 * devolve os ids. `gross` = valor lançado (bruto) da operação.
 */
async function createLinkedFees(
  ownerId: string,
  mainId: string,
  type: TransactionType,
  accountId: string,
  transferAccountId: string | null | undefined,
  gross: number,
  date: string,
  description: string,
): Promise<string[]> {
  const accounts = await loadAccounts(ownerId);
  const charges = linkedChargesFor(type, accountId, transferAccountId, gross, accounts);
  const ids: string[] = [];
  for (const ch of charges) {
    if (!ch.targetAccount) continue;
    const desc = `Taxa ${ch.targetAccount.name} (${ch.sourceAccount.name})${description ? ` — ${description}` : ""}`;
    const rec: Transaction = {
      ownerId,
      date,
      amount: Math.round(ch.amount * 10000) / 10000,
      type: "expense",
      description: desc,
      accountId: ch.targetAccount.id!,
      categoryId: ch.rule.categoryId ?? null,
      transferAccountId: null,
      costCenterId: ch.rule.costCenterId ?? null,
      contactId: null,
      installment: null,
      installmentGroupId: null,
      importBatchId: null,
      billId: null,
      billPaymentId: null,
      feeOfId: mainId,
      notes: `Regra da conta ${ch.sourceAccount.name}: gasto em ${ch.targetAccount.name}`,
      dedupHash: dedupHash({ date, amount: ch.amount, description: desc, account: ch.targetAccount.id! }),
      createdAt: Date.now(),
    };
    ids.push((await addDoc(collection(db, COLLECTIONS.transactions), rec)).id);
  }
  return ids;
}

async function deleteLinkedFees(ids: string[] | null | undefined): Promise<void> {
  for (const id of ids ?? []) await deleteDoc(doc(db, COLLECTIONS.transactions, id)).catch(() => {});
}

/**
 * Cria (ou atualiza) o lançamento da taxa ligado a `mainId` e devolve os
 * campos de taxa do principal. Usado na criação e na edição pelo formulário.
 */
async function applyFee(
  ownerId: string,
  mainId: string,
  input: TransactionInput,
  existingFeeId: string | null,
): Promise<Partial<Transaction>> {
  const fee = input.fee!;
  const account = await loadAccount(fee.accountId);
  if (!account) throw new Error("Conta da taxa não encontrada.");
  const gross = Math.abs(input.amount);
  const feeRec = buildFeeRecord(ownerId, account, fee.amount, input.date, input.description, mainId);
  let feeId = existingFeeId;
  if (feeId) {
    const { createdAt: _c, ...patch } = feeRec;
    void _c;
    await updateDoc(doc(db, COLLECTIONS.transactions, feeId), patch as Record<string, unknown>);
  } else {
    feeId = (await addDoc(collection(db, COLLECTIONS.transactions), feeRec)).id;
  }
  if (fee.learn) await learnFee(account, gross, fee.amount);
  return {
    amount: mainAmount(input.type, gross, fee.amount, fee.accountId === input.accountId),
    feeTransactionId: feeId,
    feeAmount: round2(fee.amount),
    feeGross: round2(gross),
  };
}

function buildRecord(ownerId: string, input: TransactionInput, createdAt: number): Transaction {
  const record: Transaction = {
    ownerId,
    date: input.date,
    amount: Math.abs(input.amount),
    type: input.type,
    description: input.description,
    accountId: input.accountId,
    categoryId: input.categoryId ?? null,
    transferAccountId: input.type === "transfer" ? (input.transferAccountId ?? null) : null,
    costCenterId: input.costCenterId ?? null,
    contactId: input.contactId ?? null,
    installment: null,
    installmentGroupId: null,
    importBatchId: null,
    billId: null,
    billPaymentId: null,
    dedupHash: dedupHash({
      date: input.date,
      amount: input.amount,
      description: input.description,
      account: input.accountId,
    }),
    createdAt,
  };
  if (input.notes && input.notes.trim()) record.notes = input.notes.trim();
  return record;
}

/**
 * Build the ledger transaction that materializes a bill settlement (baixa), so
 * it shows up in Lançamentos and affects account balances. `payable`
 * settlements are expenses; `receivable` settlements are income. When no account
 * can be resolved (e.g. imported títulos with no account), the entry is still
 * created with an empty account so it appears in Lançamentos — the user can
 * assign the account later, and balance math safely ignores account-less entries.
 */
export function buildBillPaymentTransaction(
  bill: Bill,
  payment: BillPayment,
  extra?: { externalId?: string | null; reconciled?: boolean },
): Transaction {
  const accountId = payment.accountId ?? bill.accountId ?? "";
  const type: TransactionType = bill.kind === "receivable" ? "income" : "expense";
  const record: Transaction = {
    ownerId: bill.ownerId,
    date: payment.date,
    amount: Math.abs(payment.amount),
    type,
    description: bill.description,
    accountId,
    categoryId: bill.categoryId ?? null,
    transferAccountId: null,
    costCenterId: bill.costCenterId ?? null,
    contactId: bill.contactId ?? null,
    installment: null,
    installmentGroupId: null,
    importBatchId: null,
    billId: bill.id ?? null,
    billPaymentId: payment.id,
    notes: bill.kind === "receivable" ? "Baixa de conta a receber" : "Baixa de conta a pagar",
    externalId: extra?.externalId ?? null,
    dedupHash: dedupHash({
      date: payment.date,
      amount: payment.amount,
      description: bill.description,
      account: accountId,
    }),
    createdAt: Date.now(),
  };
  if (extra?.reconciled) record.reconciled = true;
  return record;
}

/** Create a manual transaction. Returns its id. */
export async function createTransaction(
  ownerId: string,
  input: TransactionInput,
): Promise<string> {
  const now = Date.now();
  const ref = await addDoc(collection(db, COLLECTIONS.transactions), buildRecord(ownerId, input, now));
  if (input.fee && input.fee.amount > 0) {
    try {
      const patch = await applyFee(ownerId, ref.id, input, null);
      await updateDoc(ref, patch as Record<string, unknown>);
    } catch (err) {
      // Sem taxa gravada, o principal também não fica (nada pela metade).
      await deleteDoc(ref).catch(() => {});
      throw err;
    }
  }
  // Regras vinculadas (gasto em outra conta): sempre pela configuração.
  try {
    const linked = await createLinkedFees(
      ownerId, ref.id, input.type, input.accountId, input.transferAccountId, Math.abs(input.amount), input.date, input.description,
    );
    if (linked.length > 0) await updateDoc(ref, { linkedFeeTransactionIds: linked });
  } catch {
    /* sem regras ou falha ao ler contas: o lançamento fica sem vinculados */
  }
  await appendAudit({
    ownerId,
    action: "manual_create",
    details: { id: ref.id, description: input.description, amount: input.amount },
    at: now,
  });
  return ref.id;
}

/** Update an existing transaction (recomputes the dedup hash). */
export async function updateTransaction(
  ownerId: string,
  id: string,
  input: TransactionInput,
): Promise<void> {
  const now = Date.now();
  const record = buildRecord(ownerId, input, now);
  // Keep the original createdAt; only content fields change.
  const { createdAt: _omit, ...patch } = record;
  void _omit;
  const ref = doc(db, COLLECTIONS.transactions, id);
  const before = await getDoc(ref);
  const old = before.exists() ? (before.data() as Transaction) : null;
  const oldFeeId = old?.feeTransactionId ?? null;
  const feePatch: Partial<Transaction> = {};

  if (input.fee !== undefined) {
    // O formulário decidiu a taxa: cria/atualiza ou remove o lançamento dela.
    if (input.fee && input.fee.amount > 0) {
      Object.assign(feePatch, await applyFee(ownerId, id, input, oldFeeId));
    } else {
      if (oldFeeId) await deleteDoc(doc(db, COLLECTIONS.transactions, oldFeeId)).catch(() => {});
      Object.assign(feePatch, { feeTransactionId: null, feeAmount: null, feeGross: null });
    }
  } else if (oldFeeId) {
    // Edição rápida (sem o campo de taxa): a taxa continua; só acompanha
    // data e descrição, e o valor lançado é recalculado.
    const feeAcc = old?.feeAmount ?? 0;
    const feeSnap = await getDoc(doc(db, COLLECTIONS.transactions, oldFeeId));
    if (feeSnap.exists()) {
      const feeTx = feeSnap.data() as Transaction;
      const accName = feeTx.description.replace(/^Taxa\s+/, "").split(" — ")[0];
      await updateDoc(doc(db, COLLECTIONS.transactions, oldFeeId), {
        date: input.date,
        description: `Taxa ${accName}${input.description ? ` — ${input.description}` : ""}`,
      });
      const onSource = input.type === "transfer" && feeTx.accountId === input.accountId;
      feePatch.feeGross = round2(Math.abs(input.amount) + (onSource ? feeAcc : 0));
    }
  } else if (old?.feeOfId) {
    // Editando o próprio lançamento de taxa: o principal guarda o novo valor.
    await updateDoc(doc(db, COLLECTIONS.transactions, old.feeOfId), {
      feeAmount: round2(Math.abs(input.amount)),
    }).catch(() => {});
  }

  // Regras vinculadas: recria quando valor, conta, tipo ou data mudam.
  const linkedPatch: Partial<Transaction> = {};
  if (old && !old.feeOfId) {
    const oldGross = old.feeGross ?? old.amount;
    const changed =
      Math.abs(oldGross - Math.abs(input.amount)) > 0.005 ||
      old.accountId !== input.accountId ||
      (old.transferAccountId ?? null) !== (input.transferAccountId ?? null) ||
      old.type !== input.type ||
      old.date !== input.date ||
      old.description !== input.description;
    if (changed || (old.linkedFeeTransactionIds?.length ?? 0) === 0) {
      await deleteLinkedFees(old.linkedFeeTransactionIds);
      try {
        linkedPatch.linkedFeeTransactionIds = await createLinkedFees(
          ownerId, id, input.type, input.accountId, input.transferAccountId, Math.abs(input.amount), input.date, input.description,
        );
      } catch {
        linkedPatch.linkedFeeTransactionIds = [];
      }
    }
  }

  await updateDoc(ref, {
    ...patch,
    ...(old?.feeOfId ? { feeOfId: old.feeOfId } : {}),
    notes: input.notes?.trim() ?? null,
    ...feePatch,
    ...linkedPatch,
  });
  await appendAudit({
    ownerId,
    action: "manual_update",
    details: { id, description: input.description, amount: input.amount },
    at: now,
  });
}

/** Toggle the bank-reconciliation (cleared) flag on a transaction. */
export async function setReconciled(id: string, reconciled: boolean): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.transactions, id), { reconciled });
}

/**
 * Apply the same classification patch (categoria / centro de custo / contato)
 * to many transactions at once. Only the given fields change; one audit entry
 * records the batch.
 */
export async function bulkPatchTransactions(
  ownerId: string,
  ids: string[],
  patch: Partial<Pick<Transaction, "categoryId" | "costCenterId" | "contactId">>,
): Promise<void> {
  for (const id of ids) {
    await updateDoc(doc(db, COLLECTIONS.transactions, id), patch as Record<string, unknown>);
  }
  await appendAudit({
    ownerId,
    action: "manual_update",
    details: { bulk: true, count: ids.length, patch },
    at: Date.now(),
  });
}

/** Delete a transaction. */
export async function removeTransaction(ownerId: string, id: string): Promise<void> {
  const now = Date.now();
  const ref = doc(db, COLLECTIONS.transactions, id);
  const snap = await getDoc(ref).catch(() => null);
  const t = snap?.exists() ? (snap.data() as Transaction) : null;
  // A taxa vai junto com o lançamento que a originou.
  if (t?.feeTransactionId) {
    await deleteDoc(doc(db, COLLECTIONS.transactions, t.feeTransactionId)).catch(() => {});
  }
  await deleteLinkedFees(t?.linkedFeeTransactionIds);
  // Excluindo só a taxa: o principal deixa de apontar para ela.
  if (t?.feeOfId) {
    await updateDoc(doc(db, COLLECTIONS.transactions, t.feeOfId), {
      feeTransactionId: null,
      feeAmount: null,
      feeGross: null,
    }).catch(() => {});
  }
  await deleteDoc(ref);
  await appendAudit({ ownerId, action: "manual_delete", details: { id }, at: now });
}

/**
 * Taxa da conta num lançamento já criado fora do formulário (baixa de
 * título): se a conta cobra taxa neste tipo de operação, cria o lançamento
 * da taxa e liga os dois. Sem `override`, usa o percentual/fixo da conta;
 * com `override`, usa o valor que o usuário decidiu na tela e, se `learn`,
 * grava o novo percentual na conta. Devolve a taxa (0 quando não se aplica).
 */
export async function applyAccountFeeToTransaction(
  mainId: string,
  main: Transaction,
  override?: { amount: number; learn?: boolean },
): Promise<number> {
  if (!main.accountId) return 0;
  // Regras vinculadas (gasto em outra conta) valem mesmo sem taxa própria.
  try {
    const linked = await createLinkedFees(
      main.ownerId, mainId, main.type, main.accountId, main.transferAccountId, main.amount, main.date, main.description,
    );
    if (linked.length > 0) await updateDoc(doc(db, COLLECTIONS.transactions, mainId), { linkedFeeTransactionIds: linked });
  } catch {
    /* sem regras: segue */
  }
  const account = await loadAccount(main.accountId);
  if (!account?.fee || !feeApplies(account.fee, main.type)) return 0;
  const fee = override ? round2(Math.max(0, override.amount)) : computeFee(main.amount, account.fee);
  if (fee <= 0) return 0;
  if (override?.learn) await learnFee(account, main.amount, fee);
  const feeRef = await addDoc(
    collection(db, COLLECTIONS.transactions),
    buildFeeRecord(main.ownerId, account, fee, main.date, main.description, mainId),
  );
  await updateDoc(doc(db, COLLECTIONS.transactions, mainId), {
    feeTransactionId: feeRef.id,
    feeAmount: fee,
    feeGross: round2(main.amount),
  });
  return fee;
}

/** Apaga um lançamento e a taxa ligada a ele (sem auditoria; uso interno). */
export async function deleteTransactionWithFee(id: string): Promise<void> {
  const ref = doc(db, COLLECTIONS.transactions, id);
  const snap = await getDoc(ref).catch(() => null);
  const t = snap?.exists() ? (snap.data() as Transaction) : null;
  if (t?.feeTransactionId) await deleteDoc(doc(db, COLLECTIONS.transactions, t.feeTransactionId)).catch(() => {});
  await deleteLinkedFees(t?.linkedFeeTransactionIds);
  await deleteDoc(ref);
}
