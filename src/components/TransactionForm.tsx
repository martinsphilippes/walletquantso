"use client";

import { useMemo, useRef, useState } from "react";
import { maskBrAmount, parseBrCurrency } from "@/lib/br/parse";
import { effectiveCostCenterId } from "@/lib/categories/tree";
import {
  computeFee,
  describeFee,
  feeAccountFor,
  feeFromRealized,
  learnedPercent,
  realizedFromFee,
} from "@/lib/fees/fee";
import type { Account, Category, Contact, CostCenter, TransactionType } from "@/types";
import type { TransactionInput } from "@/services/transactions";
import { todayBr } from "@/lib/br/date";
import { LinkedFeeNote } from "@/components/FeeFields";

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

const MONTHS = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

/** Number of days in a given month (1-based month). */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
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
  const initialDate = initial?.date ?? todayBr();
  const [iy, im, id] = initialDate.split("-").map(Number);

  const [type, setType] = useState<TransactionType>(initial?.type ?? "expense");
  const [day, setDay] = useState<number>(id || new Date().getDate());
  const [month, setMonth] = useState<number>(im || new Date().getMonth() + 1);
  const [year, setYear] = useState<number>(iy || new Date().getFullYear());
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

  // ── Taxa da conta (ex.: Depix) ─────────────────────────────────────────
  // null = calculada pela configuração da conta; número = valor fixado. Na
  // edição de um lançamento existente começa com a taxa que ele já tinha
  // (ou zero, se não tinha): lançamentos antigos não ganham taxa sozinhos.
  const editingExisting = !!initial && "fee" in initial;
  const [feeOverride, setFeeOverride] = useState<number | null>(
    editingExisting ? (initial?.fee?.amount ?? 0) : null,
  );
  // O usuário digitou na taxa ou no realizado nesta tela → aprende o percentual.
  const [feeTyped, setFeeTyped] = useState(false);
  const [feeFocus, setFeeFocus] = useState<"fee" | "realized" | null>(null);
  const [feeText, setFeeText] = useState("");
  const [realizedText, setRealizedText] = useState("");

  const thisYear = new Date().getFullYear();
  const years: number[] = [];
  for (let y = thisYear + 1; y >= thisYear - 6; y--) years.push(y);

  // Clamp the day to the selected month/year (e.g. 31 -> 30 in April).
  const maxDay = daysInMonth(year, month);
  const safeDay = Math.min(day, maxDay);

  const gross = parseBrCurrency(amount) ?? 0;
  const feeTarget = feeAccountFor(type, accountId, type === "transfer" ? transferAccountId : null, accounts);
  const feeCfg = feeTarget?.account.fee ?? null;
  const autoFee = feeCfg ? computeFee(gross, feeCfg) : 0;
  const feeValue = feeTarget ? Math.max(0, feeOverride ?? autoFee) : 0;
  const realizedValue = realizedFromFee(type, gross, feeValue);
  const feeIsLearned =
    feeTyped && !!feeCfg && gross > 0 && Math.abs(feeValue - autoFee) > 0.005;
  const newPercent = feeIsLearned && feeCfg ? learnedPercent(gross, feeValue, feeCfg.fixed ?? 0) : null;

  function onFeeInput(raw: string) {
    const masked = maskBrAmount(raw);
    setFeeText(masked);
    setFeeTyped(true);
    setFeeOverride(parseBrCurrency(masked) ?? 0);
  }
  function onRealizedInput(raw: string) {
    const masked = maskBrAmount(raw);
    setRealizedText(masked);
    setFeeTyped(true);
    const r = parseBrCurrency(masked) ?? 0;
    setFeeOverride(Math.max(0, feeFromRealized(type, gross, r)));
  }
  function resetFee() {
    setFeeOverride(null);
    setFeeTyped(false);
  }

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
    const date = `${year}-${String(month).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
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
      fee: feeTarget && feeValue > 0
        ? { accountId: feeTarget.account.id!, amount: feeValue, learn: feeIsLearned }
        : null,
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
        <div style={{ ...col, flex: "1 1 220px" }}>
          <span className="muted">Data</span>
          <div style={{ display: "flex", gap: "0.35rem" }}>
            <select
              aria-label="Dia"
              value={safeDay}
              onChange={(e) => setDay(Number(e.target.value))}
              style={{ ...f, flex: "0 0 4.2rem" }}
            >
              {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {String(d).padStart(2, "0")}
                </option>
              ))}
            </select>
            <select
              aria-label="Mês"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              style={{ ...f, flex: "1 1 auto" }}
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
            <select
              aria-label="Ano"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              style={{ ...f, flex: "0 0 5.2rem" }}
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
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

      {feeTarget && feeCfg && (
        <div
          style={{
            display: "flex",
            gap: "0.75rem",
            flexWrap: "wrap",
            alignItems: "flex-end",
            marginTop: "0.75rem",
            padding: "0.6rem 0.75rem",
            border: "1px dashed var(--border)",
            borderRadius: 8,
          }}
        >
          <label style={col}>
            <span className="muted">
              Taxa {feeTarget.account.name} ({describeFee(feeCfg)})
            </span>
            <input
              value={feeFocus === "fee" ? feeText : formatAmount(feeValue)}
              onFocus={() => {
                setFeeFocus("fee");
                setFeeText(formatAmount(feeValue));
              }}
              onBlur={() => setFeeFocus(null)}
              onChange={(e) => onFeeInput(e.target.value)}
              inputMode="numeric"
              style={{ ...f, textAlign: "right" }}
            />
          </label>
          <label style={col}>
            <span className="muted">
              {type === "expense"
                ? "Valor realizado (sai da conta)"
                : type === "income"
                  ? "Valor realizado (entra na conta)"
                  : "Valor realizado (chega no destino)"}
            </span>
            <input
              value={feeFocus === "realized" ? realizedText : formatAmount(realizedValue)}
              onFocus={() => {
                setFeeFocus("realized");
                setRealizedText(formatAmount(realizedValue));
              }}
              onBlur={() => setFeeFocus(null)}
              onChange={(e) => onRealizedInput(e.target.value)}
              inputMode="numeric"
              style={{ ...f, textAlign: "right", fontWeight: 700 }}
            />
          </label>
          <div style={{ flex: "2 1 240px", fontSize: "0.8rem" }} className="muted">
            {newPercent != null ? (
              <>
                Nova taxa: <strong style={{ color: "var(--warn)" }}>
                  {newPercent.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%
                </strong>
                {(feeCfg.fixed ?? 0) > 0 ? " + fixo" : ""} — passa a valer nos próximos lançamentos.{" "}
                <button
                  type="button"
                  onClick={resetFee}
                  style={{ background: "transparent", border: "none", color: "var(--focus)", padding: 0, cursor: "pointer", font: "inherit" }}
                >
                  usar a taxa da conta
                </button>
              </>
            ) : (
              <>A taxa vira um lançamento à parte. Edite a taxa ou o realizado se o valor real for outro.</>
            )}
          </div>
        </div>
      )}

      {accountId && gross > 0 && (
        <div style={{ marginTop: "0.5rem" }}>
          <LinkedFeeNote
            type={type}
            accountId={accountId}
            transferAccountId={type === "transfer" ? transferAccountId : null}
            gross={gross}
            accounts={accounts}
          />
        </div>
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
