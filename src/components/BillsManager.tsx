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
} from "@/services/bills";
import { parseBrCurrency } from "@/lib/br/parse";
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

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const today = () => new Date().toISOString().slice(0, 10);
const brDate = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "—");
const rid = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

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
  contactId: string;
  categoryId: string;
  costCenterId: string;
  accountId: string;
  notes: string;
}

const emptyDraft = (): Draft => ({
  description: "",
  amount: "",
  dueDate: today(),
  contactId: "",
  categoryId: "",
  costCenterId: "",
  accountId: "",
  notes: "",
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
  const [showPaid, setShowPaid] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setError("");
    try {
      const [b, a, c, cc, ct] = await Promise.all([
        listBills(user.uid, kind),
        listAccounts(user.uid),
        listCategories(user.uid),
        listCostCenters(user.uid),
        listContacts(user.uid),
      ]);
      setBills(sortByDueDate(b));
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
  const summary = useMemo(() => summarizeBills(bills ?? [], t), [bills, t]);
  const contactName = useMemo(
    () => new Map(contacts.map((c) => [c.id!, c.name])),
    [contacts],
  );
  const visible = useMemo(
    () => (bills ?? []).filter((b) => showPaid || billStatus(b, t) !== "paid"),
    [bills, showPaid, t],
  );

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
      contactId: d.contactId || null,
      categoryId: d.categoryId || null,
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
    setBusy(true);
    setError("");
    try {
      await createBill({ ownerId: user.uid, kind, payments: [], createdAt: Date.now(), ...fields });
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
    setDraft({
      description: b.description,
      amount: String(b.amount).replace(".", ","),
      dueDate: b.dueDate,
      contactId: b.contactId ?? "",
      categoryId: b.categoryId ?? "",
      costCenterId: b.costCenterId ?? "",
      accountId: b.accountId ?? "",
      notes: b.notes ?? "",
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
  }

  async function confirmPay(b: Bill) {
    const amount = parseBrCurrency(payAmount);
    if (amount == null || amount <= 0) {
      setError("Informe um valor de baixa maior que zero.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await addPayment(b.id!, {
        id: rid(),
        date: payDate || today(),
        amount,
        accountId: payAccount || null,
      });
      setPayingId(null);
      await load();
    } catch (err) {
      setError(`Falha ao registrar baixa: ${(err as Error).message}`);
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
        <form onSubmit={createNew} style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <input
            placeholder="Descrição"
            value={creating.description}
            onChange={(e) => setCreating({ ...creating, description: e.target.value })}
            required
            style={{ ...fieldStyle, minWidth: 200 }}
          />
          <input
            placeholder="Valor (R$)"
            value={creating.amount}
            onChange={(e) => setCreating({ ...creating, amount: e.target.value })}
            style={{ ...fieldStyle, width: 120, textAlign: "right" }}
          />
          <label style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
            <span className="muted" style={{ fontSize: "0.75rem" }}>Vencimento</span>
            <input
              type="date"
              value={creating.dueDate}
              onChange={(e) => setCreating({ ...creating, dueDate: e.target.value })}
              style={fieldStyle}
            />
          </label>
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
          <select
            value={creating.categoryId}
            onChange={(e) => setCreating({ ...creating, categoryId: e.target.value })}
          >
            <option value="">Categoria…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button type="submit" disabled={busy}>
            Adicionar
          </button>
        </form>
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
          <span className="muted">{visible.length} título(s)</span>
          <label className="muted" style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            <input
              type="checkbox"
              checked={showPaid}
              onChange={(e) => setShowPaid(e.target.checked)}
            />
            Mostrar quitados
          </label>
        </div>
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
                  <th>Vencimento</th>
                  <th>Descrição</th>
                  <th>{contactLabel}</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Valor</th>
                  <th style={{ textAlign: "right" }}>Em aberto</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((b) => {
                  const status = billStatus(b, t);
                  const rem = remaining(b);
                  const paid = paidAmount(b);
                  const editing = editingId === b.id;
                  const paying = payingId === b.id;
                  return (
                    <Fragment key={b.id}>
                      <tr>
                        <td style={{ whiteSpace: "nowrap" }}>{brDate(b.dueDate)}</td>
                        <td>{b.description}</td>
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
                          <td colSpan={7} style={subRowStyle}>
                            <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
                              <strong>{settleLabel}:</strong>
                              <input
                                value={payAmount}
                                onChange={(e) => setPayAmount(e.target.value)}
                                style={{ ...fieldStyle, width: 110, textAlign: "right" }}
                              />
                              <input
                                type="date"
                                value={payDate}
                                onChange={(e) => setPayDate(e.target.value)}
                                style={fieldStyle}
                              />
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
                            </div>
                          </td>
                        </tr>
                      )}

                      {editing && (
                        <tr key={`${b.id}-edit`}>
                          <td colSpan={7} style={subRowStyle}>
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
                                <input
                                  type="date"
                                  value={draft.dueDate}
                                  onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })}
                                  style={fieldStyle}
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
                                  onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}
                                >
                                  <option value="">—</option>
                                  {categories.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.name}
                                    </option>
                                  ))}
                                </select>
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
                          <td colSpan={7} style={{ ...subRowStyle, paddingTop: 0 }}>
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
