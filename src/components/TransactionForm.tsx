"use client";

import { useMemo, useRef, useState } from "react";
import { maskBrAmount, parseBrCurrency } from "@/lib/br/parse";
import { effectiveCostCenterId } from "@/lib/categories/tree";
import { feeAccountFor } from "@/lib/fees/fee";
import type { Account, Category, Contact, CostCenter, TransactionType } from "@/types";
import type { TransactionInput } from "@/services/transactions";
import { todayBr } from "@/lib/br/date";
import { FEE_AUTO, FeeFields, resolveFee, type FeeState } from "@/components/FeeFields";
import { DatePicker } from "@/components/DatePicker";

interface Props {
  accounts: Account[];
  categories: Category[];
  costCenters?: CostCenter[];
  contacts?: Contact[];
  initial?: Partial<TransactionInput>;
  submitLabel: string;
  busy?: boolean;
  /**
   * Fast-entry mode: after saving, the form stays open with EVERY field still
   * filled (a ready-to-edit duplicate of what was just saved); the value comes
   * back focused and selected so typing replaces it.
   */
  quickEntry?: boolean;
  onSubmit: (input: TransactionInput) => void;
  onCancel: () => void;
}

/** Format an existing numeric amount for editing (e.g. 123.4 -> "123,40"). */
function formatAmount(value: number | undefined): string {
  if (value == null) return "";
  return Math.abs(value).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function TransactionForm({
  accounts,
  categories,
  costCenters = [],
  contacts = [],
  initial,
  submitLabel,
  busy,
  quickEntry,
  onSubmit,
  onCancel,
}: Props) {
  const [type, setType] = useState<TransactionType>(initial?.type ?? "expense");
  const [date, setDate] = useState<string>(initial?.date || todayBr());
  const [amount, setAmount] = useState(formatAmount(initial?.amount));
  const [description, setDescription] = useState(initial?.description ?? "");
  const [accountId, setAccountId] = useState(initial?.accountId ?? "");
  const [transferAccountId, setTransferAccountId] = useState(initial?.transferAccountId ?? "");
  // Categoria e subcategoria são campos separados. O registro guarda um único
  // categoryId (a subcategoria quando escolhida); aqui ele é dividido em dois.
  const initialCat = categories.find((c) => c.id === (initial?.categoryId ?? ""));
  const [categoryId, setCategoryId] = useState(
    initialCat?.parentId ?? initialCat?.id ?? "",
  );
  const [subcategoryId, setSubcategoryId] = useState(
    initialCat?.parentId ? (initialCat.id ?? "") : "",
  );
  const [costCenterId, setCostCenterId] = useState(initial?.costCenterId ?? "");
  const [contactId, setContactId] = useState(initial?.contactId ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState("");
  const amountRef = useRef<HTMLInputElement>(null);

  // ── Taxa da conta (ex.: Depix) e gastos vinculados (ex.: L-BTC) ─────────
  // override null = calculada pela configuração da conta; número = valor
  // fixado. Na edição de um lançamento existente começa com a taxa que ele
  // já tinha (ou zero, se não tinha): lançamentos antigos não ganham taxa
  // sozinhos. Os campos ficam no FeeFields, o mesmo das baixas de títulos.
  const editingExisting = !!initial && "fee" in initial;
  const [fee, setFee] = useState<FeeState>(
    editingExisting ? { override: initial?.fee?.amount ?? 0, typed: false } : FEE_AUTO,
  );
  const resetFee = () => setFee(FEE_AUTO);

  const gross = parseBrCurrency(amount) ?? 0;
  const feeTransferAccountId = type === "transfer" ? transferAccountId : null;
  const feeTarget = feeAccountFor(type, accountId, feeTransferAccountId, accounts);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
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
      categoryId: (subcategoryId || categoryId) || null,
      costCenterId: costCenterId || null,
      contactId: contactId || null,
      notes: notes.trim() || undefined,
      fee: (() => {
        const d = resolveFee(type, accountId, feeTransferAccountId, value, accounts, fee);
        return d && d.amount > 0 ? d : null;
      })(),
    });

    if (quickEntry) {
      // Duplicação rápida: TUDO permanece preenchido para o próximo
      // lançamento (descrição, valor, data, conta, classificação, notas) —
      // o usuário ajusta só o que mudar. O valor volta focado e selecionado,
      // então digitar já substitui.
      setError("");
      // Próximo lançamento volta a calcular pela conta (já com o percentual aprendido).
      resetFee();
      amountRef.current?.focus();
      amountRef.current?.select();
    }
  }

  // O centro de custo dita a linha: escolhido o centro, só aparecem categorias
  // daquele centro; escolhida a categoria, só as subcategorias dela.
  const mainCategories = categories.filter(
    (c) =>
      !c.parentId &&
      (c.kind === type || type === "transfer") &&
      (!costCenterId || (c.costCenterId ?? "") === costCenterId),
  );
  const subOptions = categoryId
    ? categories.filter((c) => c.parentId === categoryId)
    : [];
  const catById = useMemo(
    () => new Map(categories.filter((c) => c.id).map((c) => [c.id as string, c])),
    [categories],
  );

  // Trocar o centro invalida categoria/sub que não pertencem a ele.
  function pickCenter(id: string) {
    setCostCenterId(id);
    if (id && categoryId) {
      const cc = effectiveCostCenterId(catById.get(categoryId), catById);
      if (cc !== id) {
        setCategoryId("");
        setSubcategoryId("");
      }
    }
  }

  // Sem centro escolhido, a categoria ainda pode puxá-lo automaticamente.
  function pickCategory(id: string) {
    setCategoryId(id);
    setSubcategoryId("");
    if (!costCenterId) {
      const cc = effectiveCostCenterId(id ? catById.get(id) : undefined, catById);
      if (cc) setCostCenterId(cc);
    }
  }

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
        <div style={col}>
          <span className="muted">Data</span>
          <DatePicker value={date} onChange={setDate} />
        </div>
        <label style={col}>
          <span className="muted">{feeTarget ? "Valor lançado (R$)" : "Valor (R$)"}</span>
          <input
            ref={amountRef}
            value={amount}
            onChange={(e) => setAmount(maskBrAmount(e.target.value))}
            inputMode="numeric"
            placeholder="0,00"
            style={{ ...f, textAlign: "right" }}
          />
        </label>
      </div>

      {accountId && (
        <FeeFields
          type={type}
          accountId={accountId}
          transferAccountId={feeTransferAccountId}
          gross={gross}
          accounts={accounts}
          state={fee}
          onChange={setFee}
          style={{ marginTop: "0.75rem" }}
        />
      )}

      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
        <label style={{ ...col, flex: "2 1 260px" }}>
          <span className="muted">Descrição</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={f}
          />
        </label>
        <div style={{ ...col, flex: "1 1 260px" }}>
          <span className="muted">{type === "transfer" ? "Conta de origem" : "Conta"}</span>
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
            {accounts.map((a) => (
              <button
                key={a.id}
                type="button"
                style={accountCard(accountId === a.id)}
                onClick={() => setAccountId(a.id!)}
              >
                {a.name}
              </button>
            ))}
          </div>
        </div>
        {type === "transfer" && (
          <div style={{ ...col, flex: "1 1 260px" }}>
            <span className="muted">Conta de destino</span>
            <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
              {accounts.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  style={accountCard(transferAccountId === a.id)}
                  onClick={() => setTransferAccountId(a.id!)}
                >
                  {a.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
        {costCenters.length > 0 && (
          <label style={col}>
            <span className="muted">Centro de custo</span>
            <select value={costCenterId ?? ""} onChange={(e) => pickCenter(e.target.value)}>
              <option value="">— nenhum —</option>
              {costCenters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {type !== "transfer" && (
          <label style={col}>
            <span className="muted">Categoria</span>
            <select value={categoryId ?? ""} onChange={(e) => pickCategory(e.target.value)}>
              <option value="">— nenhuma —</option>
              {mainCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {type !== "transfer" && subOptions.length > 0 && (
          <label style={col}>
            <span className="muted">Subcategoria</span>
            <select value={subcategoryId} onChange={(e) => setSubcategoryId(e.target.value)}>
              <option value="">— nenhuma —</option>
              {subOptions.map((c) => (
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
          {quickEntry ? "Fechar" : "Cancelar"}
        </button>
        {quickEntry && (
          <span className="muted" style={{ marginLeft: "0.75rem", fontSize: "0.8rem" }}>
            Após salvar, tudo fica preenchido para o próximo — ajuste só o que mudar.
          </span>
        )}
      </p>
    </form>
  );
}

const col: React.CSSProperties = { display: "flex", flexDirection: "column", gap: "0.2rem", flex: "1 1 160px" };

/** Card clicável de conta (em vez de select): destaque na conta escolhida. */
const accountCard = (active: boolean): React.CSSProperties => ({
  padding: "0.45rem 0.9rem",
  borderRadius: 8,
  border: active ? "2px solid var(--accent)" : "1px solid var(--border)",
  background: active ? "var(--accent)" : "var(--panel)",
  color: active ? "var(--accent-ink)" : "var(--text)",
  font: "inherit",
  fontWeight: active ? 700 : 400,
  cursor: "pointer",
});
const f: React.CSSProperties = {
  padding: "0.35rem 0.5rem",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--panel)",
  color: "var(--text)",
  font: "inherit",
};
