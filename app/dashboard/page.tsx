"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LoginGate } from "@/components/LoginGate";
import { useAuth } from "@/services/auth-context";
import { listAccounts, listCategories, listTransactions } from "@/services/firestore";
import {
  createTransaction,
  updateTransaction,
  removeTransaction,
  type TransactionInput,
} from "@/services/transactions";
import { TransactionForm } from "@/components/TransactionForm";
import { transactionsToCsv } from "@/lib/export/csv";
import { downloadText } from "@/lib/export/download";
import {
  filterTransactions,
  summarize,
  type DashboardFilters,
} from "@/lib/dashboard/filter";
import type { Account, Category, Transaction, TransactionType } from "@/types";

const TYPE_LABELS: Record<TransactionType, string> = {
  income: "Receita",
  expense: "Despesa",
  transfer: "Transferência",
};

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function DashboardPage() {
  return (
    <>
      <h1>Dashboard</h1>
      <LoginGate>
        <Dashboard />
      </LoginGate>
    </>
  );
}

function Dashboard() {
  const { user } = useAuth();
  const [txs, setTxs] = useState<Transaction[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accountName, setAccountName] = useState<Map<string, string>>(new Map());
  const [categoryName, setCategoryName] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<DashboardFilters>({});
  const [form, setForm] = useState<{ mode: "new" } | { mode: "edit"; tx: Transaction } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setError("");
    try {
      const [t, a, c] = await Promise.all([
        listTransactions(user.uid),
        listAccounts(user.uid),
        listCategories(user.uid),
      ]);
      setTxs(t);
      setAccounts(a);
      setCategories(c);
      setAccountName(new Map(a.map((x) => [x.id!, x.name])));
      setCategoryName(new Map(c.map((x) => [x.id!, x.name])));
    } catch (err) {
      setError(`Falha ao carregar: ${(err as Error).message}`);
      setTxs([]);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(
    () => (txs ? filterTransactions(txs, filters) : []),
    [txs, filters],
  );
  const summary = useMemo(() => summarize(filtered), [filtered]);

  const set = (patch: Partial<DashboardFilters>) =>
    setFilters((prev) => ({ ...prev, ...patch }));

  const nameOfAccount = (id?: string | null) =>
    id ? (accountName.get(id) ?? id) : "—";

  function exportCsv() {
    const csv = transactionsToCsv(filtered, {
      account: (id) => (id ? (accountName.get(id) ?? id) : ""),
      category: (id) => (id ? (categoryName.get(id) ?? "") : ""),
    });
    downloadText("walletquantso-lancamentos.csv", csv);
  }

  async function handleSubmit(input: TransactionInput) {
    if (!user) return;
    setSaving(true);
    setError("");
    try {
      if (form?.mode === "edit") await updateTransaction(user.uid, form.tx.id!, input);
      else await createTransaction(user.uid, input);
      setForm(null);
      await load();
    } catch (err) {
      setError(`Falha ao salvar: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(tx: Transaction) {
    if (!user || !tx.id) return;
    if (!confirm(`Excluir o lançamento "${tx.description || tx.date}"?`)) return;
    setError("");
    try {
      await removeTransaction(user.uid, tx.id);
      await load();
    } catch (err) {
      setError(`Falha ao excluir: ${(err as Error).message}`);
    }
  }

  const txToInput = (t: Transaction): Partial<TransactionInput> => ({
    date: t.date,
    amount: t.amount,
    type: t.type,
    description: t.description,
    accountId: t.accountId,
    transferAccountId: t.transferAccountId,
    categoryId: t.categoryId,
    notes: t.notes,
  });

  if (txs === null) {
    return (
      <div className="panel">
        <p className="muted">Carregando…</p>
      </div>
    );
  }

  return (
    <>
      {error && <p className="badge err">{error}</p>}

      <div className="stat-row">
        <Stat label="Receitas" value={brl(summary.income)} color="var(--ok)" />
        <Stat label="Despesas" value={brl(summary.expense)} color="var(--err)" />
        <Stat
          label="Saldo"
          value={brl(summary.balance)}
          color={summary.balance >= 0 ? "var(--ok)" : "var(--err)"}
        />
        <Stat label="Lançamentos" value={String(summary.count)} />
      </div>

      {form ? (
        <TransactionForm
          accounts={accounts}
          categories={categories}
          initial={form.mode === "edit" ? txToInput(form.tx) : undefined}
          submitLabel={form.mode === "edit" ? "Salvar alterações" : "Adicionar lançamento"}
          busy={saving}
          onSubmit={handleSubmit}
          onCancel={() => setForm(null)}
        />
      ) : (
        <p>
          <button onClick={() => setForm({ mode: "new" })} disabled={accounts.length === 0}>
            + Novo lançamento
          </button>
          {accounts.length === 0 && (
            <span className="muted"> — crie uma conta primeiro em “Contas”.</span>
          )}
        </p>
      )}

      <div className="panel">
        <h2>Filtros</h2>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <input
            placeholder="Buscar descrição…"
            value={filters.text ?? ""}
            onChange={(e) => set({ text: e.target.value })}
            style={fieldStyle}
          />
          <select
            value={filters.accountId ?? ""}
            onChange={(e) => set({ accountId: e.target.value || undefined })}
          >
            <option value="">Todas as contas</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select
            value={filters.type ?? ""}
            onChange={(e) => set({ type: (e.target.value || "") as TransactionType | "" })}
          >
            <option value="">Todos os tipos</option>
            <option value="income">Receita</option>
            <option value="expense">Despesa</option>
            <option value="transfer">Transferência</option>
          </select>
          <input
            type="date"
            value={filters.from ?? ""}
            onChange={(e) => set({ from: e.target.value || undefined })}
            style={fieldStyle}
          />
          <input
            type="date"
            value={filters.to ?? ""}
            onChange={(e) => set({ to: e.target.value || undefined })}
            style={fieldStyle}
          />
          {Object.keys(filters).length > 0 && (
            <button style={{ background: "var(--border)" }} onClick={() => setFilters({})}>
              Limpar
            </button>
          )}
        </div>
      </div>

      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <span className="muted">{filtered.length} lançamento(s)</span>
          <button
            style={{ background: "var(--border)" }}
            onClick={exportCsv}
            disabled={filtered.length === 0}
          >
            Exportar CSV
          </button>
        </div>
        {filtered.length === 0 ? (
          <p className="muted">Nenhum lançamento encontrado.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Descrição</th>
                <th>Tipo</th>
                <th>Categoria</th>
                <th>Conta</th>
                <th style={{ textAlign: "right" }}>Valor</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id}>
                  <td>{t.date.split("-").reverse().join("/")}</td>
                  <td>{t.description}</td>
                  <td>{TYPE_LABELS[t.type]}</td>
                  <td>{t.categoryId ? (categoryName.get(t.categoryId) ?? t.categoryId) : "—"}</td>
                  <td>
                    {t.type === "transfer"
                      ? `${nameOfAccount(t.accountId)} → ${nameOfAccount(t.transferAccountId)}`
                      : nameOfAccount(t.accountId)}
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      color:
                        t.type === "income"
                          ? "var(--ok)"
                          : t.type === "expense"
                            ? "var(--err)"
                            : "var(--text)",
                    }}
                  >
                    {t.type === "expense" ? "-" : t.type === "income" ? "+" : ""}
                    {brl(t.amount)}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button
                      style={{ background: "var(--border)", padding: "0.3rem 0.6rem" }}
                      onClick={() => setForm({ mode: "edit", tx: t })}
                    >
                      Editar
                    </button>{" "}
                    <button
                      style={{ background: "var(--err)", padding: "0.3rem 0.6rem" }}
                      onClick={() => handleDelete(t)}
                    >
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

const fieldStyle: React.CSSProperties = {
  padding: "0.35rem 0.5rem",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
  font: "inherit",
};
