"use client";

// WalletQuantso — /rapido: tela enxuta para celular.
//
// Mini Dashboard (saldos por conta + resultado do mês realizado) e lançamento
// rápido, tudo em uma coluna com alvos grandes de toque. Sem menu, sem
// gráficos, sem tabelas — carrega o mínimo e abre rápido. Os dados são os
// mesmos do app completo (mesma conta, mesmo login).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { LoginGate } from "@/components/LoginGate";
import { useAuth } from "@/services/auth-context";
import {
  listAccounts,
  listCategories,
  listCostCenters,
  listTransactions,
} from "@/services/firestore";
import { listBills } from "@/services/bills";
import {
  createTransaction,
  updateTransaction,
  removeTransaction,
} from "@/services/transactions";
import { computeCashBalances, monthResult } from "@/lib/dashboard/cash";
import { effectiveCostCenterId } from "@/lib/categories/tree";
import { parseBrCurrency } from "@/lib/br/parse";
import { todayBr, currentMonthBr } from "@/lib/br/date";
import { DateParts } from "@/components/DateParts";
import type { Account, Bill, Category, CostCenter, Transaction } from "@/types";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Máscara centavos-primeiro ("12345" -> "123,45"), igual ao form principal. */
function maskAmount(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return (parseInt(digits, 10) / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function RapidoPage() {
  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "0.75rem" }}>
      <LoginGate>
        <Rapido />
      </LoginGate>
    </div>
  );
}

function Rapido() {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [payables, setPayables] = useState<Bill[]>([]);
  const [receivables, setReceivables] = useState<Bill[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    setError("");
    try {
      const [a, t, pay, rec, cat, cc] = await Promise.all([
        listAccounts(user.uid),
        listTransactions(user.uid),
        listBills(user.uid, "payable"),
        listBills(user.uid, "receivable"),
        listCategories(user.uid),
        listCostCenters(user.uid),
      ]);
      setAccounts(a);
      setTxs(t);
      setPayables(pay);
      setReceivables(rec);
      setCategories(cat);
      setCostCenters(cc.sort((x, y) => x.name.localeCompare(y.name, "pt-BR")));
    } catch (err) {
      setError(`Falha ao carregar: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const cash = useMemo(
    () => computeCashBalances(accounts, txs, payables, receivables),
    [accounts, txs, payables, receivables],
  );
  const month = useMemo(
    () => monthResult(txs, payables, receivables, currentMonthBr(), "realized"),
    [txs, payables, receivables],
  );

  // ── Lançamento rápido ────────────────────────────────────────────────────
  const [type, setType] = useState<"expense" | "income">("expense");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [accountId, setAccountId] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [subcategoryId, setSubcategoryId] = useState("");
  const [date, setDate] = useState(todayBr());
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const amountRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  // Edição/clonagem dos últimos lançamentos direto nesta tela.
  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const [confirmDelTx, setConfirmDelTx] = useState<string | null>(null);

  const accountName = useMemo(
    () => new Map(accounts.map((a) => [a.id!, a.name])),
    [accounts],
  );
  const recentTxs = useMemo(
    () =>
      [...txs]
        .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : b.date < a.date ? -1 : 1))
        .slice(0, 8),
    [txs],
  );

  const catById = useMemo(
    () => new Map(categories.filter((c) => c.id).map((c) => [c.id as string, c])),
    [categories],
  );
  // Cascata: centro → categoria (do tipo e do centro) → subcategoria.
  const mains = categories.filter(
    (c) =>
      !c.parentId &&
      c.kind === type &&
      (!costCenterId || (c.costCenterId ?? "") === costCenterId),
  );
  const subs = categoryId ? categories.filter((c) => c.parentId === categoryId) : [];

  function pickType(t: "expense" | "income") {
    setType(t);
    setCategoryId("");
    setSubcategoryId("");
  }
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
  function pickCategory(id: string) {
    setCategoryId(id);
    setSubcategoryId("");
    if (!costCenterId) {
      const cc = effectiveCostCenterId(id ? catById.get(id) : undefined, catById);
      if (cc) setCostCenterId(cc);
    }
  }

  /** Preenche o formulário com os dados de um lançamento (edição/clone). */
  function fillFrom(t: Transaction) {
    if (t.type === "transfer") return;
    setType(t.type);
    setAmount(
      t.amount.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    );
    setDescription(t.description ?? "");
    setAccountId(t.accountId ?? "");
    const cat = t.categoryId ? catById.get(t.categoryId) : undefined;
    setCategoryId(cat?.parentId ?? cat?.id ?? "");
    setSubcategoryId(cat?.parentId ? (cat.id ?? "") : "");
    setCostCenterId(t.costCenterId ?? "");
    setMsg("");
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function startEditTx(t: Transaction) {
    fillFrom(t);
    setDate(t.date);
    setEditingTxId(t.id!);
  }

  function startCloneTx(t: Transaction) {
    fillFrom(t);
    setDate(todayBr());
    setEditingTxId(null);
  }

  function resetForm() {
    setEditingTxId(null);
    setAmount("");
    setDescription("");
    setCategoryId("");
    setSubcategoryId("");
    setDate(todayBr());
    setMsg("");
  }

  async function deleteTx(t: Transaction) {
    if (!user || !t.id) return;
    setSaving(true);
    setMsg("");
    try {
      await removeTransaction(user.uid, t.id);
      setConfirmDelTx(null);
      if (editingTxId === t.id) resetForm();
      await load();
      setMsg(`✅ Lançamento de ${brl(t.amount)} excluído.`);
    } catch (err) {
      setMsg(`❌ Falha ao excluir: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    if (!user) return;
    const value = parseBrCurrency(amount);
    if (value == null || value <= 0) {
      setMsg("Informe o valor.");
      return;
    }
    if (!accountId) {
      setMsg("Escolha a conta.");
      return;
    }
    setSaving(true);
    setMsg("");
    try {
      const input = {
        date,
        amount: value,
        type,
        description: description.trim(),
        accountId,
        transferAccountId: null,
        categoryId: (subcategoryId || categoryId) || null,
        costCenterId: costCenterId || null,
        contactId: null,
      };
      if (editingTxId) {
        await updateTransaction(user.uid, editingTxId, input);
        resetForm();
        setMsg(`✅ Lançamento atualizado (${brl(value)}).`);
      } else {
        await createTransaction(user.uid, input);
        setMsg(`✅ ${type === "expense" ? "Despesa" : "Receita"} de ${brl(value)} lançada.`);
        // Mantém tudo preenchido (duplicação rápida); valor volta focado.
        amountRef.current?.focus();
        amountRef.current?.select();
      }
      await load();
    } catch (err) {
      setMsg(`❌ Falha ao salvar: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="muted" style={{ padding: "1rem" }}>Carregando…</p>;
  }

  return (
    <>
      {error && <p className="badge warn">{error}</p>}

      {/* Mini Dashboard */}
      <div className="panel" style={{ padding: "0.9rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <strong style={{ fontSize: "1.05rem" }}>Saldos</strong>
          <span
            style={{
              fontSize: "1.25rem",
              fontWeight: 800,
              color: cash.totalConfirmed >= 0 ? "var(--ok)" : "var(--err)",
            }}
          >
            {brl(cash.totalConfirmed)}
          </span>
        </div>
        {cash.rows
          .filter((r) => r.accountId)
          .map((r) => (
            <div
              key={r.accountId}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "0.3rem 0",
                borderTop: "1px solid var(--border)",
              }}
            >
              <span className="muted">{r.name}</span>
              <span style={{ fontWeight: 600, color: r.confirmed >= 0 ? "var(--ok)" : "var(--err)" }}>
                {brl(r.confirmed)}
              </span>
            </div>
          ))}
      </div>

      <div className="panel" style={{ padding: "0.9rem" }}>
        <strong style={{ fontSize: "1.05rem" }}>Resultado do mês (realizado)</strong>
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", textAlign: "center" }}>
          <MiniStat label="Receitas" value={brl(month.income)} color="var(--ok)" />
          <MiniStat label="Despesas" value={brl(month.expense)} color="var(--err)" />
          <MiniStat
            label="Resultado"
            value={brl(month.result)}
            color={month.result >= 0 ? "var(--ok)" : "var(--err)"}
          />
        </div>
      </div>

      {/* Lançamento rápido */}
      <div className="panel" style={{ padding: "0.9rem" }} ref={formRef}>
        <strong style={{ fontSize: "1.05rem" }}>
          {editingTxId ? "Editando lançamento" : "Lançamento rápido"}
        </strong>

        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.6rem" }}>
          <button
            type="button"
            style={bigToggle(type === "expense", "var(--err)")}
            onClick={() => pickType("expense")}
          >
            Despesa
          </button>
          <button
            type="button"
            style={bigToggle(type === "income", "var(--ok)")}
            onClick={() => pickType("income")}
          >
            Receita
          </button>
        </div>

        <input
          ref={amountRef}
          value={amount}
          onChange={(e) => setAmount(maskAmount(e.target.value))}
          inputMode="numeric"
          placeholder="0,00"
          aria-label="Valor (R$)"
          style={{
            ...field,
            marginTop: "0.6rem",
            fontSize: "1.6rem",
            fontWeight: 700,
            textAlign: "right",
            width: "100%",
          }}
        />

        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Descrição"
          style={{ ...field, marginTop: "0.6rem", width: "100%" }}
        />

        <div style={{ marginTop: "0.6rem" }}>
          <span className="muted" style={{ fontSize: "0.8rem" }}>Conta</span>
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginTop: "0.25rem" }}>
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

        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.6rem" }}>
          {costCenters.length > 0 && (
            <label style={col}>
              <span className="muted" style={{ fontSize: "0.8rem" }}>Centro de custo</span>
              <select value={costCenterId} onChange={(e) => pickCenter(e.target.value)} style={field}>
                <option value="">— nenhum —</option>
                {costCenters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label style={col}>
            <span className="muted" style={{ fontSize: "0.8rem" }}>Categoria</span>
            <select value={categoryId} onChange={(e) => pickCategory(e.target.value)} style={field}>
              <option value="">— nenhuma —</option>
              {mains.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {subs.length > 0 && (
            <label style={col}>
              <span className="muted" style={{ fontSize: "0.8rem" }}>Subcategoria</span>
              <select
                value={subcategoryId}
                onChange={(e) => setSubcategoryId(e.target.value)}
                style={field}
              >
                <option value="">— nenhuma —</option>
                {subs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div style={{ marginTop: "0.6rem" }}>
          <span className="muted" style={{ fontSize: "0.8rem" }}>Data</span>
          <div style={{ marginTop: "0.25rem" }}>
            <DateParts value={date} onChange={setDate} />
          </div>
        </div>

        <button
          disabled={saving}
          onClick={save}
          style={{
            width: "100%",
            marginTop: "0.9rem",
            padding: "0.9rem",
            fontSize: "1.1rem",
            fontWeight: 700,
            borderRadius: 10,
          }}
        >
          {saving ? "Salvando…" : editingTxId ? "Salvar alterações" : "Salvar lançamento"}
        </button>
        {editingTxId && (
          <button
            disabled={saving}
            onClick={resetForm}
            style={{
              width: "100%",
              marginTop: "0.5rem",
              padding: "0.7rem",
              borderRadius: 10,
              background: "var(--border)",
            }}
          >
            Cancelar edição
          </button>
        )}

        {msg && (
          <p style={{ marginTop: "0.6rem", marginBottom: 0 }}>
            <span className={`badge ${msg.startsWith("✅") ? "ok" : "warn"}`}>{msg}</span>
          </p>
        )}
      </div>

      {/* Últimos lançamentos */}
      <div className="panel" style={{ padding: "0.9rem" }}>
        <strong style={{ fontSize: "1.05rem" }}>Últimos lançamentos</strong>
        {recentTxs.length === 0 ? (
          <p className="muted">Nenhum lançamento ainda.</p>
        ) : (
          recentTxs.map((t) => {
            const isTransfer = t.type === "transfer";
            const signed = t.type === "income" ? t.amount : -t.amount;
            return (
              <div
                key={t.id}
                style={{ borderTop: "1px solid var(--border)", padding: "0.55rem 0" }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "0.5rem",
                    alignItems: "baseline",
                  }}
                >
                  <span style={{ fontWeight: 600, minWidth: 0, overflowWrap: "anywhere" }}>
                    {t.description || "—"}
                  </span>
                  <span
                    style={{
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                      color: isTransfer
                        ? "var(--muted)"
                        : signed >= 0
                          ? "var(--ok)"
                          : "var(--err)",
                    }}
                  >
                    {isTransfer ? "⇄ " : signed >= 0 ? "+" : "-"}
                    {brl(Math.abs(t.amount))}
                  </span>
                </div>
                <div className="muted" style={{ fontSize: "0.78rem", marginTop: "0.1rem" }}>
                  {t.date.split("-").reverse().join("/")}
                  {t.accountId ? ` · ${accountName.get(t.accountId) ?? ""}` : ""}
                  {isTransfer ? " · transferência" : ""}
                </div>
                <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.35rem", flexWrap: "wrap" }}>
                  {confirmDelTx === t.id ? (
                    <>
                      <span className="muted" style={{ fontSize: "0.82rem", alignSelf: "center" }}>
                        Excluir?
                      </span>
                      <button
                        disabled={saving}
                        style={{ ...smallBtn, background: "var(--err)" }}
                        onClick={() => deleteTx(t)}
                      >
                        Confirmar
                      </button>
                      <button
                        style={{ ...smallBtn, background: "var(--border)" }}
                        onClick={() => setConfirmDelTx(null)}
                      >
                        Cancelar
                      </button>
                    </>
                  ) : (
                    <>
                      {!isTransfer && (
                        <>
                          <button
                            style={{ ...smallBtn, background: "var(--border)" }}
                            onClick={() => startEditTx(t)}
                          >
                            Editar
                          </button>
                          <button
                            style={{ ...smallBtn, background: "var(--border)" }}
                            onClick={() => startCloneTx(t)}
                          >
                            Clonar
                          </button>
                        </>
                      )}
                      <button
                        style={{ ...smallBtn, background: "var(--err)" }}
                        onClick={() => setConfirmDelTx(t.id!)}
                      >
                        Excluir
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <p style={{ textAlign: "center" }}>
        <Link href="/dashboard" className="muted" style={{ fontSize: "0.85rem" }}>
          Abrir app completo →
        </Link>
      </p>
    </>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontWeight: 700, color, whiteSpace: "nowrap", fontSize: "0.95rem" }}>
        {value}
      </div>
      <div className="muted" style={{ fontSize: "0.75rem" }}>{label}</div>
    </div>
  );
}

const field: React.CSSProperties = {
  padding: "0.6rem 0.7rem",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
  font: "inherit",
};

const col: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.2rem",
  flex: "1 1 140px",
};

const bigToggle = (active: boolean, color: string): React.CSSProperties => ({
  flex: 1,
  padding: "0.8rem",
  fontSize: "1.05rem",
  fontWeight: 700,
  borderRadius: 10,
  border: active ? `2px solid ${color}` : "1px solid var(--border)",
  background: active ? color : "var(--panel)",
  color: active ? "#fff" : "var(--text)",
  cursor: "pointer",
});

const smallBtn: React.CSSProperties = {
  padding: "0.4rem 0.8rem",
  borderRadius: 8,
  fontSize: "0.85rem",
};

const accountCard = (active: boolean): React.CSSProperties => ({
  padding: "0.6rem 1rem",
  borderRadius: 10,
  border: active ? "2px solid var(--accent)" : "1px solid var(--border)",
  background: active ? "var(--accent)" : "var(--panel)",
  color: active ? "var(--accent-ink)" : "var(--text)",
  font: "inherit",
  fontWeight: active ? 700 : 400,
  cursor: "pointer",
});
