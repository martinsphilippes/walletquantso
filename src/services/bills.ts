// WalletQuantso — bills (payables/receivables) data access + writes.
//
// A bill carries its settlements inline as a `payments` array, so partial
// payments are a single-document update and the owner-scoped security rules
// stay simple. Status is never stored — it is derived from payments + due date
// by the pure helpers in lib/bills/status.

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  updateDoc,
  writeBatch,
  type DocumentData,
} from "firebase/firestore";
import { db } from "./firebase";
import { COLLECTIONS } from "./firestore";
import { liveList } from "./live-store";
import {
  applyAccountFeeToTransaction,
  buildBillPaymentTransaction,
  deleteTransactionWithFee,
} from "./transactions";
import { setRidesBillState } from "./drivers";
import { classifyPatch, linkedPaymentsFor } from "@/lib/bills/link";
import type { Bill, BillKind, BillPayment, Transaction } from "@/types";

const round2 = (n: number) => Math.round(n * 100) / 100;
const newPaymentId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Lançamento abatido num título volta a ficar livre (continua em Lançamentos). */
async function unlinkTransaction(txId: string): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.transactions, txId), { billId: null, billPaymentId: null }).catch(() => {});
}

/** Título de motorista quitado/reaberto/excluído → reflete nos lançamentos de corrida. */
async function syncRides(ownerId: string, billId: string, state: "paid" | "unpaid" | "detached"): Promise<void> {
  try {
    await setRidesBillState(ownerId, billId, state);
  } catch {
    /* sem corridas ligadas (ou sem permissão): nada a fazer */
  }
}

/** List a user's bills of a given kind. */
export async function listBills(ownerId: string, kind: BillKind): Promise<Bill[]> {
  // Assinatura viva única da coleção; o `kind` é filtrado em memória, então
  // contas a pagar e a receber dividem a mesma sincronização.
  const all = await liveList<Bill>(COLLECTIONS.bills, ownerId);
  return all.filter((b) => b.kind === kind);
}

/** Create a bill. Returns its id. */
export async function createBill(bill: Omit<Bill, "id">): Promise<string> {
  const ref = await addDoc(collection(db, COLLECTIONS.bills), bill);
  return ref.id;
}

/** Update mutable fields of a bill. */
export async function updateBill(id: string, patch: Partial<Bill>): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.bills, id), patch as DocumentData);
}

/** Delete a bill. */
export async function removeBill(id: string): Promise<void> {
  const snap = await getDoc(doc(db, COLLECTIONS.bills, id));
  const bill = snap.exists() ? (snap.data() as Bill) : null;
  const ownerId = bill?.ownerId ?? null;
  await deleteDoc(doc(db, COLLECTIONS.bills, id));
  // Lançamentos que já existiam e foram abatidos neste título ficam livres.
  for (const p of bill?.payments ?? []) {
    if (p.linked && p.transactionId) await unlinkTransaction(p.transactionId);
  }
  if (ownerId) await syncRides(ownerId, id, "detached");
}

/**
 * Abate no título lançamentos que JÁ existem (recebidos/pagos antes de o
 * título ser gerado, ex.: Pix do cliente ao longo do mês): cada um vira uma
 * baixa que aponta para ele, sem criar lançamento novo — o dinheiro segue
 * contado uma vez só, pelo lançamento. O lançamento fica marcado como baixa
 * deste título (billId/billPaymentId) e, com `classify`, recebe a categoria,
 * o centro e o contato do título onde estiverem vazios. Tudo é gravado de uma
 * vez (lote): ou abate todos, ou nenhum.
 */
export async function linkTransactionsToBill(
  id: string,
  txs: Transaction[],
  opts?: { classify?: boolean },
): Promise<{ count: number; total: number; remaining: number }> {
  const snap = await getDoc(doc(db, COLLECTIONS.bills, id));
  if (!snap.exists()) throw new Error("Título não encontrado.");
  const bill: Bill = { ...(snap.data() as Bill), id };
  const want = bill.kind === "receivable" ? "income" : "expense";
  const already = new Set((bill.payments ?? []).map((p) => p.transactionId).filter(Boolean));
  const chosen = txs.filter(
    (t) => !!t.id && t.type === want && !t.feeOfId && t.amount > 0 && !already.has(t.id),
  );
  if (chosen.length === 0) throw new Error("Nenhum lançamento válido para abater neste título.");
  // Limite do lote do Firestore (500 escritas), com folga.
  if (chosen.length > 400) throw new Error("Selecione até 400 lançamentos por vez.");
  // Nunca abate duas vezes: lançamento que já é baixa de outro título que
  // ainda existe fica de fora (título apagado libera o lançamento).
  for (const t of chosen) {
    if (!t.billId || t.billId === id) continue;
    const other = await getDoc(doc(db, COLLECTIONS.bills, t.billId)).catch(() => null);
    if (other?.exists()) throw new Error(`"${t.description}" já é baixa de outro título.`);
  }

  const newPayments = linkedPaymentsFor(chosen, newPaymentId);
  const payments = [...(bill.payments ?? []), ...newPayments];
  const batch = writeBatch(db);
  chosen.forEach((t, i) => {
    batch.update(doc(db, COLLECTIONS.transactions, t.id!), {
      billId: id,
      billPaymentId: newPayments[i].id,
      ...(opts?.classify ? classifyPatch(t, bill) : {}),
    });
  });
  batch.update(doc(db, COLLECTIONS.bills, id), { payments });
  await batch.commit();

  const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
  if (totalPaid + 0.005 >= bill.amount) await syncRides(bill.ownerId, id, "paid");
  return {
    count: newPayments.length,
    total: round2(newPayments.reduce((s, p) => s + p.amount, 0)),
    remaining: round2(Math.max(0, bill.amount - totalPaid)),
  };
}

/**
 * Close a partially-paid title at the amount already paid: the real value turned
 * out to be what was settled, so the outstanding remainder is dropped. Sets the
 * bill's amount to the sum of its payments (remaining → 0, status → paid) without
 * adding a new payment or lançamento. No-op if nothing has been paid.
 */
export async function settleBillAtPaid(id: string): Promise<void> {
  const snap = await getDoc(doc(db, COLLECTIONS.bills, id));
  if (!snap.exists()) throw new Error("Título não encontrado.");
  const bill = snap.data() as Bill;
  const paid = (bill.payments ?? []).reduce((s, p) => s + (p.amount || 0), 0);
  if (paid <= 0) throw new Error("O título ainda não tem baixa para quitar.");
  await updateDoc(doc(db, COLLECTIONS.bills, id), { amount: Math.round(paid * 100) / 100 });
  await syncRides(bill.ownerId, id, "paid");
}

/**
 * Append a settlement to a bill and materialize it as a ledger transaction, so
 * the baixa shows up in Lançamentos and moves the account balance. The created
 * transaction id is stored on the payment for undo/consistency.
 */
export async function addPayment(
  id: string,
  payment: BillPayment,
  opts?: {
    settle?: boolean;
    externalId?: string | null;
    reconciled?: boolean;
    /**
     * Taxa da conta (ex.: Depix) decidida na tela: valor e se o percentual
     * deve ser aprendido. `undefined` = calcula pela conta; `null` = sem taxa.
     */
    fee?: { amount: number; learn?: boolean } | null;
  },
): Promise<void> {
  const snap = await getDoc(doc(db, COLLECTIONS.bills, id));
  if (!snap.exists()) throw new Error("Título não encontrado.");
  const bill = { id, ...(snap.data() as Bill) };

  // Materialize the cash movement as a transaction so it shows in Lançamentos.
  const txRecord = buildBillPaymentTransaction(bill, payment, {
    externalId: opts?.externalId ?? null,
    reconciled: opts?.reconciled,
  });
  const txRef = await addDoc(collection(db, COLLECTIONS.transactions), txRecord);
  // Conta com taxa (ex.: Depix): a taxa vira um lançamento à parte, ligado.
  if (opts?.fee !== null) {
    try {
      await applyAccountFeeToTransaction(txRef.id, txRecord, opts?.fee ?? undefined);
    } catch {
      /* sem taxa configurada ou falha ao ler a conta: a baixa segue sem taxa */
    }
  }

  // Record the settlement on the bill. If this fails, roll back the transaction
  // so we never end up with a lançamento that didn't actually settle the title.
  try {
    const stored: BillPayment = { ...payment, transactionId: txRef.id };
    const payments = [...(bill.payments ?? []), stored];
    const patch: Partial<Bill> = { payments };
    // "Quitar": close the title at the amount actually paid (the real value may
    // differ from the original), so remaining goes to zero and it leaves the list.
    if (opts?.settle) {
      const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
      patch.amount = Math.round(totalPaid * 100) / 100;
    }
    await updateDoc(doc(db, COLLECTIONS.bills, id), patch as DocumentData);
    const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
    if (opts?.settle || totalPaid + 0.005 >= (patch.amount ?? bill.amount)) {
      await syncRides(bill.ownerId, id, "paid");
    }
  } catch (err) {
    await deleteTransactionWithFee(txRef.id).catch(() => {});
    throw err;
  }
}

/**
 * Remove a settlement from a bill, deleting its materialized transaction too.
 * Baixa que abateu um lançamento que já existia (`linked`): o lançamento NÃO
 * é apagado — só deixa de ser baixa deste título.
 */
export async function removePayment(id: string, paymentId: string): Promise<void> {
  const snap = await getDoc(doc(db, COLLECTIONS.bills, id));
  if (!snap.exists()) throw new Error("Título não encontrado.");
  const bill = snap.data() as Bill;
  const gone = (bill.payments ?? []).find((p) => p.id === paymentId);
  if (gone?.transactionId && gone.linked) {
    await unlinkTransaction(gone.transactionId);
  } else if (gone?.transactionId) {
    try {
      await deleteTransactionWithFee(gone.transactionId);
    } catch {
      /* transaction may have been removed already — ignore */
    }
  }
  const payments = (bill.payments ?? []).filter((p) => p.id !== paymentId);
  await updateDoc(doc(db, COLLECTIONS.bills, id), { payments });
  const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
  if (totalPaid + 0.005 < bill.amount) await syncRides(bill.ownerId, id, "unpaid");
}

/**
 * One-time migration: materialize a transaction for every existing settlement
 * that doesn't have one yet (older baixas made before this feature). Idempotent
 * — a payment that already has a `transactionId`, or has no resolvable account,
 * is skipped. Returns how many transactions were created.
 */
export async function backfillPaymentTransactions(bills: Bill[]): Promise<number> {
  let created = 0;
  for (const b of bills) {
    if (!b.id) continue;
    const payments = [...(b.payments ?? [])];
    let changed = false;
    for (let i = 0; i < payments.length; i++) {
      const p = payments[i];
      if (p.transactionId) continue;
      const txRecord = buildBillPaymentTransaction(b, p);
      const txRef = await addDoc(collection(db, COLLECTIONS.transactions), txRecord);
      payments[i] = { ...p, transactionId: txRef.id };
      changed = true;
      created++;
    }
    if (changed) await updateDoc(doc(db, COLLECTIONS.bills, b.id), { payments });
  }
  return created;
}
