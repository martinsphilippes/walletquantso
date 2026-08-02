"use client";

import { useState } from "react";
import { parseBrCurrency } from "@/lib/br/parse";
import type { Account, Category, Contact, CostCenter, TransactionType } from "@/types";
import type { TransactionInput } from "@/services/transactions";

interface Props {
  accounts: Account[];
  categories: Category[];
  costCenters?: CostCenter[];
  contacts?: Contact[];
  initial?: Partial<TransactionInput>;
  submitLabel: string;
  busy?: boolean;
  onSubmit: (input: TransactionInput) => void;
  onCancel: () => void;
}

const today = () => new Date().toISOString().slice(0, 10);

export function TransactionForm({
  accounts,
  categories,
  costCenters = [],
  contacts = [],
  initial,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: Props) {
  const [type, setType] = useState<TransactionType>(initial?.type ?? "expense");
  const [date, setDate] = useState(initial?.date ?? today());
  const [amount, setAmount] = useState(
    initial?.amount != null ? String(initial.amount).replace(".", ",") : "",
  );
  const [description, setDescription] = useState(initial?.description ?? "");
  const [accountId, setAccountId] = useState(initial?.accountId ?? "");
  const [transferAccountId, setTransferAccountId] = useState(initial?.transferAccountId ?? "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [costCenterId, setCostCenterId] = useState(initial?.costCenterId ?? "");
  const [contactId, setContactId] = useState(initial?.contactId ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!date) return setError("Informe a data.");
    const value = parseBrCurrency(amount);
    if (value == null || value <= 0) return setError("Informe um valor maior que zero.");
    if (!accountId) return setError("Selecione a conta.");
    if (type === "transfer") {
      if (!transferAccountId) return setError("Selecione a conta de destino.");
      if (transferAccountId === accountId)
        return setError("A conta de destino deve ser diferente da origem.");
    }
    onSubmit({
      date,
      amount: value,
      type,
      description: description.trim(),
      accountId,
      transferAccountId: type === "transfer" ? transferAccountId : null,
      categoryId: categoryId || null,
      costCenterId: costCenterId || null,
      contactId: contactId || null,
      notes: notes.trim() || undefined,
    });
  }

  const relevantCategories = categories.filter((c) => c.kind === type || type === "transfer");

  return (
    <form onSubmit={submit} className="panel" style={{ background: "var(--bg)" }}>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <label style={col}>
          <span className="muted">Tipo</span>
          <select value={type} onChange={(e) => setType(e.target.value as TransactionType)}>
            <option value="expense">Despesa</option>
            <option value="income">Receita</option>
            <option value="transfer">Transferência</option>
          </select>
        </label>
        <label style={col}>
          <span className="muted">Data</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={f} />
        </label>
        <label style={col}>
          <span className="muted">Valor (R$)</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0,00"
            style={{ ...f, textAlign: "right" }}
          />
        </label>
      </div>

      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
        <label style={{ ...col, flex: "2 1 260px" }}>
          <span className="muted">Descrição</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={f}
          />
        </label>
        <label style={col}>
          <span className="muted">{type === "transfer" ? "Conta de origem" : "Conta"}</span>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">— selecione —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        {type === "transfer" && (
          <label style={col}>
            <span className="muted">Conta de destino</span>
            <select
              value={transferAccountId ?? ""}
              onChange={(e) => setTransferAccountId(e.target.value)}
            >
              <option value="">— selecione —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
        {type !== "transfer" && (
          <label style={col}>
            <span className="muted">Categoria</span>
            <select value={categoryId ?? ""} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">— nenhuma —</option>
              {relevantCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {costCenters.length > 0 && (
          <label style={col}>
            <span className="muted">Centro de custo</span>
            <select value={costCenterId ?? ""} onChange={(e) => setCostCenterId(e.target.value)}>
              <option value="">— nenhum —</option>
              {costCenters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {contacts.length > 0 && (
          <label style={col}>
            <span className="muted">Pessoa/contato</span>
            <select value={contactId ?? ""} onChange={(e) => setContactId(e.target.value)}>
              <option value="">— nenhum —</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
        <label style={{ ...col, flex: "2 1 260px" }}>
          <span className="muted">Observações</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} style={f} />
        </label>
      </div>

      {error && <p className="badge err" style={{ marginTop: "0.75rem" }}>{error}</p>}

      <p style={{ marginTop: "1rem" }}>
        <button type="submit" disabled={busy}>
          {busy ? "Salvando…" : submitLabel}
        </button>{" "}
        <button type="button" style={{ background: "var(--border)" }} onClick={onCancel}>
          Cancelar
        </button>
      </p>
    </form>
  );
}

const col: React.CSSProperties = { display: "flex", flexDirection: "column", gap: "0.2rem", flex: "1 1 160px" };
const f: React.CSSProperties = {
  padding: "0.35rem 0.5rem",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--panel)",
  color: "var(--text)",
  font: "inherit",
};
