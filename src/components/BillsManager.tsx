"use client";

// WalletQuantso — payables/receivables manager, shared by the "contas a pagar"
// and "contas a receber" pages via the `kind` prop. Handles create, edit,
// delete, and partial settlements; status is derived, never stored.

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/services/auth-context";
import {
  listAccounts,
  listCategories,
  listContacts,
  listCostCenters,
} from "@/services/firestore";
import {
  listBills,
  createBill,
  updateBill,
  removeBill,
  addPayment,
  removePayment,
  backfillPaymentTransactions,
  settleBillAtPaid,
} from "@/services/bills";
import { parseBrCurrency } from "@/lib/br/parse";
import { effectiveCostCenterId } from "@/lib/categories/tree";
import { DateParts } from "@/components/DateParts";
import { useBulkSelect, SelectAllCheckbox, RowCheckbox, BulkBar } from "@/components/BulkSelect";
import { useColumnFilters, FilterRow, type ColFilterDef } from "@/components/ColumnFilter";
import { expandRepeat, type RepeatMode } from "@/lib/bills/repeat";
import {
  billStatus,
  remaining,
  paidAmount,
  summarizeBills,
  sortByDueDate,
  STATUS_LABELS,
  type BillStatus,
} from "@/lib/bills/status";
import type { Account, Bill, BillKind, Category, Contact, CostCenter } from "@/types";
import { todayBr } from "@/lib/br/date";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const today = () => todayBr();
const brDate = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "—");
const rid = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** Next document number for this list: the highest existing numeric value + 1. */
function nextDocumentNumber(bills: Bill[]): number {
  let max = 0;
  for (const b of bills) {
    const n = parseInt(String(b.documentNumber ?? ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

const STATUS_COLOR: Record<BillStatus, string> = {
  paid: "var(--ok)",
  partial: "var(--warn)",
  overdue: "var(--err)",
  open: "var(--muted)",
};

interface Draft {
  description: string;
  amount: string;
  dueDate: string;
  competenceDate: string;
  documentNumber: string;
  contactId: string;
  /** Categoria principal escolhida (só principais aqui). */
  categoryId: string;
  /** Subcategoria da categoria acima; gravada no lugar dela quando escolhida. */
  subcategoryId: string;
  costCenterId: string;
  accountId: string;
  notes: string;
  repeatMode: RepeatMode;
  repeatCount: string;
}

const emptyDraft = (): Draft => ({
  description: "",
  amount: "",
  dueDate: today(),
  competenceDate: today(),
  documentNumber: "",
  contactId: "",
  categoryId: "",
  subcategoryId: "",
  costCenterId: "",
  accountId: "",
  notes: "",
  repeatMode: "single",
  repeatCount: "2",
});

export function BillsManager({ kind }: { kind: BillKind }) {
  const { user } = useAuth();
  const isPayable = kind === "payable";
  const contactLabel = isPayable ? "Fornecedor" : "Cliente";
  const settleLabel = isPayable ? "Pagar" : "Receber";

  const [bills, setBills] = useState<Bill[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [creating, setCreating] = useState<Draft>(emptyDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState(today());
  const [payAccount, setPayAccount] = useState("");
  // "settle" quita o título (fecha, mesmo com valor diferente); "partial" mantém o saldo.
  const [payMode, setPayMode] = useState<"settle" | "partial">("settle");

  // List filters (so you can see e.g. only the titles of a given account).
  const [fAccount, setFAccount] = useState("");
  const [fContact, setFContact] = useState("");
  const [fCategory, setFCategory] = useState("");
  const [fSubcategory, setFSubcategory] = useState("");
  const [fCostCenter, setFCostCenter] = useState("");
  const [fStatus, setFStatus] = useState<BillStatus | "">("");
  const [fText, setFText] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    setError("");
    try {
      const [b0, a, c, cc, ct] = await Promise.all([
        listBills(user.uid, kind),
        listAccounts(user.uid),
        listCategories(user.uid),
        listCostCenters(user.uid),
        listContacts(user.uid),
      ]);
      let b = b0;
      // One-time migration: turn older baixas (settlements without a ledger
      // transaction) into real lançamentos, then re-read so the list is fresh.
      const needsBackfill = b.some((bl) =>
        (bl.payments ?? []).some((p) => !p.transactionId),
      );
      if (needsBackfill) {
        await backfillPaymentTransactions(b);
        b = await listBills(user.uid, kind);
      }
      setBills(sortByDueDate(b));
      // Suggest the next document number automatically (ascending).
      setCreating((prev) => ({ ...prev, documentNumber: String(nextDocumentNumber(b)) }));
      setAccounts(a);
      setCategories(c.filter((x) => x.kind === (isPayable ? "expense" : "income")));
      cc.sort((x, y) => x.name.localeCompare(y.name, "pt-BR"));
      ct.sort((x, y) => x.name.localeCompare(y.name, "pt-BR"));
      setCostCenters(cc);
      setContacts(ct);
    } catch (err) {
      setError(`Falha ao carregar: ${(err as Error).message}`);
      setBills([]);
    }
  }, [user, kind, isPayable]);

  useEffect(() => {
    load();
  }, [load]);

  const t = today();
  const contactName = useMemo(
    () => new Map(contacts.map((c) => [c.id!, c.name])),
    [contacts],
  );
  const accountName = useMemo(
    () => new Map(accounts.map((a) => [a.id!, a.name])),
    [accounts],
  );
  const catById = useMemo(
    () => new Map(categories.filter((c) => c.id).map((c) => [c.id as string, c])),
    [categories],
  );
  // Hierarquia: centro → categoria → subcategoria. Categoria e subcategoria
  // são campos separados; a subcategoria só lista as filhas da categoria.
  const mainCategories = useMemo(() => categories.filter((c) => !c.parentId), [categories]);
  const subsOf = (mainId: string) =>
    mainId ? categories.filter((c) => c.parentId === mainId) : [];
  // Categoria pertence a um centro de custo: escolher a categoria puxa o
  // centro automaticamente (continua editável).
  const centerForCategory = (id: string) =>
    effectiveCostCenterId(id ? catById.get(id) : undefined, catById);

  // Apply the entity filters (account, contact, category, center, text). The
  // paid/status visibility toggle is applied separately, on top of this.
  const entityFiltered = useMemo(() => {
    const q = fText.trim().toLowerCase();
    return (bills ?? []).filter((b) => {
      if (fAccount && b.accountId !== fAccount) return false;
      if (fContact && b.contactId !== fContact) return false;
      if (fCategory) {
        // Filtrar pela categoria inclui as subcategorias dela.
        const cat = b.categoryId ? catById.get(b.categoryId) : undefined;
        const mainId = cat?.parentId ?? cat?.id;
        if (mainId !== fCategory) return false;
      }
      if (fSubcategory && b.categoryId !== fSubcategory) return false;
      if (fCostCenter && b.costCenterId !== fCostCenter) return false;
      if (q) {
        const hay = `${b.description ?? ""} ${b.documentNumber ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [bills, fAccount, fContact, fCategory, fSubcategory, fCostCenter, fText, catById]);

  // Totals reflect the current entity filters (e.g. only the chosen account).
  const summary = useMemo(() => summarizeBills(entityFiltered, t), [entityFiltered, t]);

  // Fully-settled (baixados) titles leave this list — they live in Lançamentos.
  // Só aparecem aqui se o filtro de Status for explicitamente "Pago".
  const visible = useMemo(
    () =>
      entityFiltered.filter((b) => {
        const st = billStatus(b, t);
        if (fStatus) return st === fStatus;
        return st !== "paid";
      }),
    [entityFiltered, fStatus, t],
  );

  // Per-column header filters, layered on top of the filter panel above.
  const colDefs: ColFilterDef<Bill>[] = [
    { key: "select", type: "none" },
    { key: "dueDate", value: (b) => brDate(b.dueDate) },
    { key: "description", value: (b) => b.description },
    {
      key: "installment",
      type: "select",
      value: (b) => (b.installment ? `${b.installment.number}/${b.installment.total}` : ""),
    },
    { key: "account", type: "select", value: (b) => (b.accountId ? (accountName.get(b.accountId) ?? "") : "") },
    { key: "contact", type: "select", value: (b) => (b.contactId ? (contactName.get(b.contactId) ?? "") : "") },
    { key: "status", type: "select", value: (b) => STATUS_LABELS[billStatus(b, t)] },
    { key: "amount", value: (b) => brl(b.amount), align: "right" },
    { key: "remaining", value: (b) => brl(remaining(b)), align: "right" },
    { key: "actions", type: "none" },
  ];
  const cf = useColumnFilters(visible, colDefs);

  const sel = useBulkSelect(cf.filtered, (b) => b.id);

  async function bulkDelete() {
    if (sel.count === 0) return;
    setBusy(true);
    setError("");
    try {
      for (const id of sel.selectedIds) await removeBill(id);
      sel.clear();
      await load();
    } catch (err) {
      setError(`Falha ao excluir: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const filterCount =
    (fAccount ? 1 : 0) +
    (fContact ? 1 : 0) +
    (fCategory ? 1 : 0) +
    (fSubcategory ? 1 : 0) +
    (fCostCenter ? 1 : 0) +
    (fStatus ? 1 : 0) +
    (fText.trim() ? 1 : 0);

  const clearFilters = () => {
    setFAccount("");
    setFContact("");
    setFCategory("");
    setFSubcategory("");
    setFCostCenter("");
    setFStatus("");
    setFText("");
  };

  function draftToBill(d: Draft): Omit<Bill, "id" | "payments" | "createdAt" | "ownerId" | "kind"> | null {
    const amount = parseBrCurrency(d.amount);
    if (!d.description.trim()) {
      setError("Informe a descrição.");
      return null;
    }
    if (amount == null || amount <= 0) {
      setError("Informe um valor maior que zero.");
      return null;
    }
    if (!d.dueDate) {
      setError("Informe o vencimento.");
      return null;
    }
    return {
      description: d.description.trim(),
      amount,
      dueDate: d.dueDate,
      competenceDate: d.competenceDate || d.dueDate,
      documentNumber: d.documentNumber.trim() || null,
      contactId: d.contactId || null,
      // Grava a subcategoria quando escolhida; senão a categoria principal.
      categoryId: (d.subcategoryId || d.categoryId) || null,
      costCenterId: d.costCenterId || null,
      accountId: d.accountId || null,
      notes: d.notes.trim() || null,
    };
  }

  async function createNew(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    const fields = draftToBill(creating);
    if (!fields) return;

    const mode = creating.repeatMode;
    let count = 1;
    if (mode !== "single") {
      count = Math.floor(Number(creating.repeatCount));
      if (!Number.isFinite(count) || count < 2) {
        setError(mode === "installments" ? "Informe pelo menos 2 parcelas." : "Informe pelo menos 2 repetições.");
        return;
      }
    }

    setBusy(true);
    setError("");
    try {
      const expanded = expandRepeat(
        { amount: fields.amount, dueDate: fields.dueDate, competenceDate: fields.competenceDate },
        mode,
        count,
      );
      const groupId = mode === "single" ? null : rid();
      const now = Date.now();
      const startDoc = (() => {
        const n = parseInt(creating.documentNumber.trim(), 10);
        return Number.isFinite(n) && n > 0 ? n : nextDocumentNumber(bills ?? []);
      })();
      for (let i = 0; i < expanded.length; i++) {
        const it = expanded[i];
        const description = it.installment
          ? `${fields.description} (${it.installment.number}/${it.installment.total})`
          : fields.description;
        await createBill({
          ownerId: user.uid,
          kind,
          payments: [],
          createdAt: now,
          ...fields,
          description,
          amount: it.amount,
          dueDate: it.dueDate,
          competenceDate: it.competenceDate,
          documentNumber: String(startDoc + i),
          installment: it.installment,
          installmentGroupId: groupId,
        });
      }
      setCreating(emptyDraft());
      await load();
    } catch (err) {
      setError(`Falha ao criar: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  function startEdit(b: Bill) {
    setPayingId(null);
    setEditingId(b.id!);
    // Se o título aponta para uma subcategoria, separa em categoria + sub.
    const cat = b.categoryId ? catById.get(b.categoryId) : undefined;
    const isSubCat = !!cat?.parentId;
    setDraft({
      description: b.description,
      amount: String(b.amount).replace(".", ","),
      dueDate: b.dueDate,
      competenceDate: b.competenceDate ?? b.dueDate,
      documentNumber: b.documentNumber ?? "",
      contactId: b.contactId ?? "",
      categoryId: isSubCat ? (cat?.parentId ?? "") : (b.categoryId ?? ""),
      subcategoryId: isSubCat ? (b.categoryId ?? "") : "",
      costCenterId: b.costCenterId ?? "",
      accountId: b.accountId ?? "",
      notes: b.notes ?? "",
      repeatMode: "single",
      repeatCount: "2",
    });
  }

  async function saveEdit(id: string) {
    const fields = draftToBill(draft);
    if (!fields) return;
    setBusy(true);
    setError("");
    try {
      await updateBill(id, fields);
      setEditingId(null);
      await load();
    } catch (err) {
      setError(`Falha ao salvar: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function del(b: Bill) {
    if (!confirm(`Excluir o título "${b.description}"?`)) return;
    setBusy(true);
    setError("");
    try {
      await removeBill(b.id!);
      await load();
    } catch (err) {
      setError(`Falha ao excluir: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  function startPay(b: Bill) {
    setEditingId(null);
    setPayingId(b.id!);
    setPayAmount(String(remaining(b)).replace(".", ","));
    setPayDate(today());
    setPayAccount(b.accountId ?? "");
    setPayMode("settle");
  }

  async function confirmPay(b: Bill) {
    const amount = parseBrCurrency(payAmount);
    if (amount == null || amount <= 0) {
      setError("Informe um valor de baixa maior que zero.");
      return;
    }
    // A baixa is real cash moving through an account, so it needs one to become
    // a lançamento (and appear in the dashboard, saldos, conciliação, etc.).
    const account = payAccount || b.accountId || "";
    if (!account) {
      setError("Selecione a conta da baixa para lançá-la no caixa.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const settle = payMode === "settle";
      await addPayment(
        b.id!,
        {
          id: rid(),
          date: payDate || today(),
          amount,
          accountId: account,
        },
        { settle },
      );
      setPayingId(null);
      // "Quitar" fecha o título; parcial fecha só se o valor cobrir o restante.
      const fullySettled = settle || amount + 0.005 >= remaining(b);
      if (fullySettled) {
        setBills((prev) => (prev ?? []).filter((x) => x.id !== b.id));
        sel.clear();
      }
      await load();
    } catch (err) {
      setError(`Falha ao registrar baixa: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function settleTitle(b: Bill) {
    setBusy(true);
    setError("");
    try {
      await settleBillAtPaid(b.id!);
      // Fecha o título pelo valor já pago → sai da lista (fica em Lançamentos).
      setBills((prev) => (prev ?? []).filter((x) => x.id !== b.id));
      sel.clear();
      await load();
    } catch (err) {
      setError(`Falha ao quitar: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function undoPayment(billId: string, paymentId: string) {
    setBusy(true);
    setError("");
    try {
      await removePayment(billId, paymentId);
      await load();
    } catch (err) {
      setError(`Falha ao desfazer baixa: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  if (bills === null) {
    return (
      <div className="panel">
        <p className="muted">Carregando…</p>
      </div>
    );
  }

  return (
    <>
      {error && <p className="badge warn">{error}</p>}

      <div className="stat-row">
        <Stat label="Em aberto" value={brl(summary.outstanding)} />
        <Stat label="Vencido" value={brl(summary.overdue)} color="var(--err)" />
        <Stat label="A vencer" value={brl(summary.upcoming)} color="var(--ok)" />
        <Stat label={`Títulos (${summary.paidCount} quitado(s))`} value={String(summary.count)} />
      </div>

      <div className="panel">
        <h2>Novo título</h2>
        <form
          onSubmit={createNew}
          style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-end" }}
        >
          <Field label={creating.repeatMode === "installments" ? "Valor total (R$)" : "Valor (R$)"}>
            <input
              placeholder="0,00"
              value={creating.amount}
              onChange={(e) => setCreating({ ...creating, amount: e.target.value })}
              style={{ ...fieldStyle, width: 130, textAlign: "right" }}
            />
          </Field>
          <Field label="Vencimento">
            <DateParts
              value={creating.dueDate}
              onChange={(iso) => setCreating({ ...creating, dueDate: iso })}
            />
          </Field>
          <Field label="Competência">
            <DateParts
              value={creating.competenceDate}
              onChange={(iso) => setCreating({ ...creating, competenceDate: iso })}
            />
          </Field>
          <Field label="Repetição">
            <select
              value={creating.repeatMode}
              onChange={(e) => setCreating({ ...creating, repeatMode: e.target.value as RepeatMode })}
            >
              <option value="single">Única</option>
              <option value="fixed">Fixa</option>
              <option value="installments">Parcelado</option>
            </select>
          </Field>
          {creating.repeatMode !== "single" && (
            <Field label={creating.repeatMode === "installments" ? "Parcelas" : "Repetições"}>
              <input
                type="number"
                min={2}
                value={creating.repeatCount}
                onChange={(e) => setCreating({ ...creating, repeatCount: e.target.value })}
                style={{ ...fieldStyle, width: 90 }}
              />
            </Field>
          )}
          <Field label="Descrição">
            <input
              placeholder="Descrição"
              value={creating.description}
              onChange={(e) => setCreating({ ...creating, description: e.target.value })}
              required
              style={{ ...fieldStyle, minWidth: 200 }}
            />
          </Field>
          <Field label="Conta">
            <select
              value={creating.accountId}
              onChange={(e) => setCreating({ ...creating, accountId: e.target.value })}
            >
              <option value="">Conta…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Categoria">
            <select
              value={creating.categoryId}
              onChange={(e) =>
                setCreating({
                  ...creating,
                  categoryId: e.target.value,
                  subcategoryId: "",
                  costCenterId: centerForCategory(e.target.value) ?? creating.costCenterId,
                })
              }
            >
              <option value="">Categoria…</option>
              {mainCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          {subsOf(creating.categoryId).length > 0 && (
            <Field label="Subcategoria">
              <select
                value={creating.subcategoryId}
                onChange={(e) => setCreating({ ...creating, subcategoryId: e.target.value })}
              >
                <option value="">— nenhuma —</option>
                {subsOf(creating.categoryId).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label={contactLabel}>
            <select
              value={creating.contactId}
              onChange={(e) => setCreating({ ...creating, contactId: e.target.value })}
            >
              <option value="">{contactLabel}…</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Centro">
            <select
              value={creating.costCenterId}
              onChange={(e) => setCreating({ ...creating, costCenterId: e.target.value })}
            >
              <option value="">Centro…</option>
              {costCenters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Nº documento (auto)">
            <input
              value={creating.documentNumber}
              onChange={(e) => setCreating({ ...creating, documentNumber: e.target.value })}
              style={{ ...fieldStyle, width: 140 }}
            />
          </Field>
          <Field label="Observações">
            <input
              value={creating.notes}
              onChange={(e) => setCreating({ ...creating, notes: e.target.value })}
              style={{ ...fieldStyle, minWidth: 180 }}
            />
          </Field>
          <button type="submit" disabled={busy}>
            Adicionar
          </button>
        </form>
        <p className="muted" style={{ marginTop: "0.6rem", fontSize: "0.85rem" }}>
          <strong>Repetição:</strong> <em>Única</em> cria um título só. <em>Fixa</em> repete o
          mesmo valor todo mês, na mesma data, pela quantidade de repetições. <em>Parcelado</em>{" "}
          divide o valor total automaticamente na quantidade de parcelas (mensais). O{" "}
          <strong>Nº documento</strong> é preenchido automaticamente em ordem crescente (você pode
          alterá-lo).
        </p>
      </div>

      <div className="panel">
        <h2>Filtros</h2>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-end" }}>
          <Field label="Conta">
            <select value={fAccount} onChange={(e) => setFAccount(e.target.value)}>
              <option value="">Todas as contas</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select value={fStatus} onChange={(e) => setFStatus(e.target.value as BillStatus | "")}>
              <option value="">Todos os status</option>
              <option value="open">{STATUS_LABELS.open}</option>
              <option value="overdue">{STATUS_LABELS.overdue}</option>
              <option value="partial">{STATUS_LABELS.partial}</option>
              <option value="paid">{STATUS_LABELS.paid}</option>
            </select>
          </Field>
          <Field label={contactLabel}>
            <select value={fContact} onChange={(e) => setFContact(e.target.value)}>
              <option value="">Todos</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Categoria">
            <select
              value={fCategory}
              onChange={(e) => {
                setFCategory(e.target.value);
                setFSubcategory("");
              }}
            >
              <option value="">Todas</option>
              {mainCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          {fCategory && subsOf(fCategory).length > 0 && (
            <Field label="Subcategoria">
              <select value={fSubcategory} onChange={(e) => setFSubcategory(e.target.value)}>
                <option value="">Todas</option>
                {subsOf(fCategory).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {costCenters.length > 0 && (
            <Field label="Centro">
              <select value={fCostCenter} onChange={(e) => setFCostCenter(e.target.value)}>
                <option value="">Todos</option>
                {costCenters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Buscar">
            <input
              placeholder="Descrição ou nº doc…"
              value={fText}
              onChange={(e) => setFText(e.target.value)}
              style={{ ...fieldStyle, minWidth: 180 }}
            />
          </Field>
          {filterCount > 0 && (
            <button type="button" style={{ background: "var(--border)" }} onClick={clearFilters}>
              Limpar ({filterCount})
            </button>
          )}
        </div>
      </div>

      <div className="panel">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "0.75rem",
          }}
        >
          <span className="muted">{cf.filtered.length} título(s)</span>
          <span className="muted" style={{ fontSize: "0.8rem" }}>
            Títulos quitados saem daqui e aparecem em Lançamentos (use Status → “Pago” para revê-los).
          </span>
        </div>
        <BulkBar sel={sel} onDelete={bulkDelete} busy={busy} noun="título" />
        {visible.length === 0 ? (
          <p className="muted">
            {bills.length === 0
              ? `Nenhuma conta a ${isPayable ? "pagar" : "receber"} ainda. Crie o primeiro título acima.`
              : "Nenhum título pendente. 🎉"}
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 32 }}><SelectAllCheckbox sel={sel} /></th>
                  <th>Vencimento</th>
                  <th>Descrição</th>
                  <th>Parcela</th>
                  <th>Conta</th>
                  <th>{contactLabel}</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Valor</th>
                  <th style={{ textAlign: "right" }}>Em aberto</th>
                  <th></th>
                </tr>
                <FilterRow defs={colDefs} cf={cf} />
              </thead>
              <tbody>
                {cf.filtered.map((b) => {
                  const status = billStatus(b, t);
                  const rem = remaining(b);
                  const paid = paidAmount(b);
                  const editing = editingId === b.id;
                  const paying = payingId === b.id;
                  return (
                    <Fragment key={b.id}>
                      <tr>
                        <td><RowCheckbox sel={sel} id={b.id} /></td>
                        <td style={{ whiteSpace: "nowrap" }}>{brDate(b.dueDate)}</td>
                        <td>{b.description}</td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          {b.installment ? (
                            <span
                              className="badge"
                              style={{ background: "var(--border)", color: "var(--text)" }}
                            >
                              {b.installment.number}/{b.installment.total}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>{b.accountId ? (accountName.get(b.accountId) ?? "—") : "—"}</td>
                        <td>{b.contactId ? (contactName.get(b.contactId) ?? "—") : "—"}</td>
                        <td>
                          <span style={{ color: STATUS_COLOR[status], fontWeight: 600 }}>
                            {STATUS_LABELS[status]}
                          </span>
                        </td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{brl(b.amount)}</td>
                        <td
                          style={{
                            textAlign: "right",
                            whiteSpace: "nowrap",
                            fontWeight: 700,
                            color: rem > 0 ? "var(--text)" : "var(--ok)",
                          }}
                        >
                          {brl(rem)}
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          {rem > 0 && (
                            <>
                              <button className="btn-primary" onClick={() => startPay(b)}>
                                {settleLabel}
                              </button>{" "}
                            </>
                          )}
                          {paid > 0 && rem > 0 && (
                            <>
                              <button
                                style={{ background: "var(--ok)", padding: "0.3rem 0.6rem" }}
                                disabled={busy}
                                title={`Encerrar o título pelo valor já pago (${brl(paid)}), descartando o saldo em aberto.`}
                                onClick={() => settleTitle(b)}
                              >
                                Quitar
                              </button>{" "}
                            </>
                          )}
                          <button
                            style={{ background: "var(--border)", padding: "0.3rem 0.6rem" }}
                            onClick={() => startEdit(b)}
                          >
                            Editar
                          </button>{" "}
                          <button
                            style={{ background: "var(--err)", padding: "0.3rem 0.6rem" }}
                            onClick={() => del(b)}
                          >
                            Excluir
                          </button>
                        </td>
                      </tr>

                      {paying && (
                        <tr key={`${b.id}-pay`}>
                          <td colSpan={10} style={subRowStyle}>
                            <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
                              <strong>{settleLabel}:</strong>
                              <select
                                value={payMode}
                                onChange={(e) => setPayMode(e.target.value as "settle" | "partial")}
                                title="Quitar fecha o título pelo valor pago; parcial mantém o saldo em aberto."
                              >
                                <option value="settle">Quitar (total)</option>
                                <option value="partial">Baixa parcial</option>
                              </select>
                              <input
                                value={payAmount}
                                onChange={(e) => setPayAmount(e.target.value)}
                                style={{ ...fieldStyle, width: 110, textAlign: "right" }}
                              />
                              <DateParts value={payDate} onChange={setPayDate} />
                              <select value={payAccount} onChange={(e) => setPayAccount(e.target.value)}>
                                <option value="">Conta…</option>
                                {accounts.map((a) => (
                                  <option key={a.id} value={a.id}>
                                    {a.name}
                                  </option>
                                ))}
                              </select>
                              <button disabled={busy} onClick={() => confirmPay(b)}>
                                Confirmar
                              </button>
                              <button
                                style={{ background: "var(--border)" }}
                                onClick={() => setPayingId(null)}
                              >
                                Cancelar
                              </button>
                              <span className="muted" style={{ fontSize: "0.78rem", flexBasis: "100%" }}>
                                {payMode === "settle"
                                  ? "Quitar: fecha o título pelo valor informado (o título sai da lista)."
                                  : "Parcial: registra só uma parte; o título continua com o saldo em aberto."}
                              </span>
                            </div>
                          </td>
                        </tr>
                      )}

                      {editing && (
                        <tr key={`${b.id}-edit`}>
                          <td colSpan={10} style={subRowStyle}>
                            <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "flex-end" }}>
                              <Field label="Descrição">
                                <input
                                  value={draft.description}
                                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                                  style={{ ...fieldStyle, minWidth: 180 }}
                                />
                              </Field>
                              <Field label="Valor">
                                <input
                                  value={draft.amount}
                                  onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                                  style={{ ...fieldStyle, width: 110, textAlign: "right" }}
                                />
                              </Field>
                              <Field label="Vencimento">
                                <DateParts
                                  value={draft.dueDate}
                                  onChange={(iso) => setDraft({ ...draft, dueDate: iso })}
                                />
                              </Field>
                              <Field label="Competência">
                                <DateParts
                                  value={draft.competenceDate}
                                  onChange={(iso) => setDraft({ ...draft, competenceDate: iso })}
                                />
                              </Field>
                              <Field label={contactLabel}>
                                <select
                                  value={draft.contactId}
                                  onChange={(e) => setDraft({ ...draft, contactId: e.target.value })}
                                >
                                  <option value="">—</option>
                                  {contacts.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.name}
                                    </option>
                                  ))}
                                </select>
                              </Field>
                              <Field label="Categoria">
                                <select
                                  value={draft.categoryId}
                                  onChange={(e) =>
                                    setDraft({
                                      ...draft,
                                      categoryId: e.target.value,
                                      subcategoryId: "",
                                      costCenterId:
                                        centerForCategory(e.target.value) ?? draft.costCenterId,
                                    })
                                  }
                                >
                                  <option value="">—</option>
                                  {mainCategories.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.name}
                                    </option>
                                  ))}
                                </select>
                              </Field>
                              {subsOf(draft.categoryId).length > 0 && (
                                <Field label="Subcategoria">
                                  <select
                                    value={draft.subcategoryId}
                                    onChange={(e) =>
                                      setDraft({ ...draft, subcategoryId: e.target.value })
                                    }
                                  >
                                    <option value="">— nenhuma —</option>
                                    {subsOf(draft.categoryId).map((c) => (
                                      <option key={c.id} value={c.id}>
                                        {c.name}
                                      </option>
                                    ))}
                                  </select>
                                </Field>
                              )}
                              <Field label="Centro">
                                <select
                                  value={draft.costCenterId}
                                  onChange={(e) => setDraft({ ...draft, costCenterId: e.target.value })}
                                >
                                  <option value="">—</option>
                                  {costCenters.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.name}
                                    </option>
                                  ))}
                                </select>
                              </Field>
                              <Field label="Nº documento">
                                <input
                                  value={draft.documentNumber}
                                  onChange={(e) => setDraft({ ...draft, documentNumber: e.target.value })}
                                  style={{ ...fieldStyle, width: 120 }}
                                />
                              </Field>
                              <div>
                                <button disabled={busy} onClick={() => saveEdit(b.id!)}>
                                  Salvar
                                </button>{" "}
                                <button
                                  style={{ background: "var(--border)" }}
                                  onClick={() => setEditingId(null)}
                                >
                                  Cancelar
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}

                      {paid > 0 && (
                        <tr key={`${b.id}-hist`}>
                          <td colSpan={10} style={{ ...subRowStyle, paddingTop: 0 }}>
                            <span className="muted" style={{ fontSize: "0.8rem" }}>
                              Baixas:{" "}
                              {b.payments.map((p) => (
                                <span key={p.id} style={{ marginRight: "0.6rem" }}>
                                  {brDate(p.date)} — {brl(p.amount)}{" "}
                                  <button
                                    title="Desfazer esta baixa"
                                    onClick={() => undoPayment(b.id!, p.id)}
                                    style={{
                                      background: "transparent",
                                      color: "var(--err)",
                                      padding: 0,
                                      border: "none",
                                      cursor: "pointer",
                                    }}
                                  >
                                    ✕
                                  </button>
                                </span>
                              ))}
                            </span>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="stat">
      <div className="n" style={{ fontSize: "1.2rem", ...(color ? { color } : {}) }}>
        {value}
      </div>
      <div className="muted">{label}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
      <span className="muted" style={{ fontSize: "0.75rem" }}>{label}</span>
      {children}
    </label>
  );
}

const fieldStyle: React.CSSProperties = {
  padding: "0.35rem 0.5rem",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
  font: "inherit",
};

const subRowStyle: React.CSSProperties = {
  background: "var(--bg)",
  padding: "0.6rem 0.75rem",
};
