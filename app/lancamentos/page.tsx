"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LoginGate } from "@/components/LoginGate";
import { useAuth } from "@/services/auth-context";
import {
  listAccounts,
  listCategories,
  listContacts,
  listCostCenters,
  listTransactions,
} from "@/services/firestore";
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
import type {
  Account,
  Category,
  Contact,
  CostCenter,
  Transaction,
  TransactionType,
} from "@/types";

const TYPE_LABELS: Record<TransactionType, string> = {
  income: "Receita",
  expense: "Despesa",
  transfer: "Transferência",
};

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function LancamentosPage() {
  return (
    <>
      <h1>Lançamentos</h1>
      <LoginGate>
        <Lancamentos />
      </LoginGate>
    </>
  );
}

function Lancamentos() {
  const { user } = useAuth();
  const [txs, setTxs] = useState<Transaction[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
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
      const [t, a, c, cc, ct] = await Promise.all([
        listTransactions(user.uid),
        listAccounts(user.uid),
        listCategories(user.uid),
        listCostCenters(user.uid),
        listContacts(user.uid),
      ]);
      setTxs(t);
      setAccounts(a);
      setCategories(c);
      cc.sort((x, y) => x.name.localeCompare(y.name, "pt-BR"));
      ct.sort((x, y) => x.name.localeCompare(y.name, "pt-BR"));
      setCostCenters(cc);
      setContacts(ct);
    } catch (err) {
      setError(`Falha ao carregar: ${(err as Error).message}`);
      setTxs([]);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const accountName = useMemo(
    () => new Map(accounts.map((x) => [x.id!, x.name])),
    [accounts],
  );
  const categoryName = useMemo(
    () => new Map(categories.map((x) => [x.id!, x.name])),
    [categories],
  );
  const costCenterName = useMemo(
    () => new Map(costCenters.map((x) => [x.id!, x.name])),
    [costCenters],
  );
  const contactName = useMemo(
    () => new Map(contacts.map((x) => [x.id!, x.name])),
    [contacts],
  );

  const filtered = useMemo(
    () => (txs ? filterTransactions(txs, filters) : []),
    [txs, filters],
  );
  const summary = useMemo(() => summarize(filtered), [filtered]);

  const set = (patch: Partial<DashboardFilters>) =>
    setFilters((prev) => ({ ...prev, ...patch }));

  const nameOfAccount = (id?: string | null) => (id ? (accountName.get(id) ?? id) : "—");
  const nameOf = (m: Map<string, string>, id?: string | null) =>
    id ? (m.get(id) ?? "—") : "—";

  function exportCsv() {
    const csv = transactionsToCsv(filtered, {
      account: (id) => (id ? (accountName.get(id) ?? id) : ""),
      category: (id) => (id ? (categoryName.get(id) ?? "") : ""),
      costCenter: (id) => (id ? (costCenterName.get(id) ?? "") : ""),
      contact: (id) => (id ? (contactName.get(id) ?? "") : ""),
    });
    downloadText("walletquantso-lancamentos.csv", csv);
  }

  async function handleSubmit(input: TransactionInput) {
    if (!user) return;
    setSaving(true);
    setError("");
    try {
      if (form?.mode === "edit") {
        await updateTransaction(user.uid, form.tx.id!, input);
        setForm(null);
      } else {
        // Quick-entry: keep the form open so several lançamentos can be added
        // in a row (the form itself keeps the selected fields fixed).
        await createTransaction(user.uid, input);
      }
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
    costCenterId: t.costCenterId,
    contactId: t.contactId,
    notes: t.notes,
  });

  const activeFilterCount = Object.values(filters).filter((v) => v).length;

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
          label="Resultado"
          value={brl(summary.balance)}
          color={summary.balance >= 0 ? "var(--ok)" : "var(--err)"}
        />
        <Stat label="Lançamentos" value={String(summary.count)} />
      </div>

      {form ? (
        <TransactionForm
          accounts={accounts}
          categories={categories}
          costCenters={costCenters}
          contacts={contacts}
          initial={form.mode === "edit" ? txToInput(form.tx) : undefined}
          submitLabel={form.mode === "edit" ? "Salvar alterações" : "Adicionar lançamento"}
          busy={saving}
          quickEntry={form.mode === "new"}
          onSubmit={handleSubmit}
          onCancel={() => setForm(null)}
        />
      ) : (
        <p>
          <button onClick={() => setForm({ mode: "new" })} disabled={accounts.length === 0}>
            + Novo lançamento
          </button>
          {accounts.length === 0 && (
            <span className="muted"> — crie uma conta primeiro em “Contas financeiras”.</span>
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
            value={filters.type ?? ""}
            onChange={(e) => set({ type: (e.target.value || "") as TransactionType | "" })}
          >
            <option value="">Todos os tipos</option>
            <option value="income">Receita</option>
            <option value="expense">Despesa</option>
            <option value="transfer">Transferência</option>
          </select>
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
            value={filters.categoryId ?? ""}
            onChange={(e) => set({ categoryId: e.target.value || undefined })}
          >
            <option value="">Todas as categorias</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {costCenters.length > 0 && (
            <select
              value={filters.costCenterId ?? ""}
              onChange={(e) => set({ costCenterId: e.target.value || undefined })}
            >
              <option value="">Todos os centros</option>
              {costCenters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {contacts.length > 0 && (
            <select
              value={filters.contactId ?? ""}
              onChange={(e) => set({ contactId: e.target.value || undefined })}
            >
              <option value="">Todos os contatos</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
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
          {activeFilterCount > 0 && (
            <button style={{ background: "var(--border)" }} onClick={() => setFilters({})}>
              Limpar
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
          <p className="muted">
            {txs.length === 0
              ? "Nenhum lançamento ainda. Crie o primeiro acima ou importe uma planilha."
              : "Nenhum lançamento encontrado com os filtros atuais."}
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Descrição</th>
                  <th>Tipo</th>
                  <th>Categoria</th>
                  <th>Centro</th>
                  <th>Contato</th>
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
                    <td>{nameOf(categoryName, t.categoryId)}</td>
                    <td>{nameOf(costCenterName, t.costCenterId)}</td>
                    <td>{nameOf(contactName, t.contactId)}</td>
                    <td>
                      {t.type === "transfer"
                        ? `${nameOfAccount(t.accountId)} → ${nameOfAccount(t.transferAccountId)}`
                        : nameOfAccount(t.accountId)}
                    </td>
                    <td
                      style={{
                        textAlign: "right",
                        whiteSpace: "nowrap",
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

const fieldStyle: React.CSSProperties = {
  padding: "0.35rem 0.5rem",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
  font: "inherit",
};
