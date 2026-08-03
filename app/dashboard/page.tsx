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
import { listBills } from "@/services/bills";
import {
  createTransaction,
  updateTransaction,
  removeTransaction,
  type TransactionInput,
} from "@/services/transactions";
import { TransactionForm } from "@/components/TransactionForm";
import { transactionsToCsv } from "@/lib/export/csv";
import { downloadText } from "@/lib/export/download";
import { filterTransactions, type DashboardFilters } from "@/lib/dashboard/filter";
import { computeOverview } from "@/lib/dashboard/overview";
import { computeCashBalances, monthResult } from "@/lib/dashboard/cash";
import {
  receitasPorCategoria,
  despesasPorCategoria,
  receitasPorCentro,
  despesasPorCentro,
  resultadosPorCentro,
  type Slice,
} from "@/lib/dashboard/breakdown";
import { ChartSwitcher, LineChart, PALETTE } from "@/components/charts";
import { projectCashFlow } from "@/lib/cashflow/project";
import { remaining, billStatus, sortByDueDate } from "@/lib/bills/status";
import type {
  Account,
  Bill,
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

const brDate = (iso: string) => iso.split("-").reverse().join("/");

const MONTHS_ABBR = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS_ABBR[m - 1]}/${String(y).slice(2)}`;
};

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
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [payables, setPayables] = useState<Bill[]>([]);
  const [receivables, setReceivables] = useState<Bill[]>([]);
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
      const [t, a, c, cc, ct, pay, rec] = await Promise.all([
        listTransactions(user.uid),
        listAccounts(user.uid),
        listCategories(user.uid),
        listCostCenters(user.uid),
        listContacts(user.uid),
        listBills(user.uid, "payable"),
        listBills(user.uid, "receivable"),
      ]);
      setTxs(t);
      setAccounts(a);
      setCategories(c);
      cc.sort((x, y) => x.name.localeCompare(y.name, "pt-BR"));
      ct.sort((x, y) => x.name.localeCompare(y.name, "pt-BR"));
      setCostCenters(cc);
      setContacts(ct);
      setPayables(pay);
      setReceivables(rec);
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

  const overview = useMemo(
    () => computeOverview(accounts, txs ?? [], payables, receivables),
    [accounts, txs, payables, receivables],
  );

  const cash = useMemo(
    () => computeCashBalances(accounts, txs ?? [], payables, receivables),
    [accounts, txs, payables, receivables],
  );

  const month = useMemo(
    () => monthResult(txs ?? [], payables, receivables),
    [txs, payables, receivables],
  );

  const recentTxs = useMemo(() => (txs ?? []).slice(0, 5), [txs]);

  const receitasCat = useMemo(
    () => receitasPorCategoria(txs ?? [], receivables, categories),
    [txs, receivables, categories],
  );
  const despesasCat = useMemo(
    () => despesasPorCategoria(txs ?? [], payables, categories),
    [txs, payables, categories],
  );
  const receitasCentro = useMemo(
    () => receitasPorCentro(txs ?? [], receivables, costCenters),
    [txs, receivables, costCenters],
  );
  const despesasCentro = useMemo(
    () => despesasPorCentro(txs ?? [], payables, costCenters),
    [txs, payables, costCenters],
  );
  const centros = useMemo(
    () => resultadosPorCentro(txs ?? [], payables, receivables, costCenters),
    [txs, payables, receivables, costCenters],
  );
  const costCenterName = useMemo(
    () => new Map(costCenters.map((c) => [c.id!, c.name])),
    [costCenters],
  );
  const centrosTotal = useMemo(
    () =>
      centros.reduce(
        (acc, c) => ({
          receitas: acc.receitas + c.receitas,
          despesas: acc.despesas + c.despesas,
          resultado: acc.resultado + c.resultado,
        }),
        { receitas: 0, despesas: 0, resultado: 0 },
      ),
    [centros],
  );

  const toDonut = (slices: Slice[]) =>
    slices.map((s, i) => ({ label: s.label, value: s.value, color: PALETTE[i % PALETTE.length] }));

  const openingBalance = useMemo(
    () => accounts.reduce((s, a) => s + (a.initialBalance ?? 0), 0),
    [accounts],
  );
  const cashflow = useMemo(
    () => projectCashFlow(txs ?? [], [...payables, ...receivables], { openingBalance }),
    [txs, payables, receivables, openingBalance],
  );
  const projectedEnd = cashflow.length ? cashflow[cashflow.length - 1].balance : openingBalance;

  const filtered = useMemo(
    () => (txs ? filterTransactions(txs, filters) : []),
    [txs, filters],
  );

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
    costCenterId: t.costCenterId,
    contactId: t.contactId,
    notes: t.notes,
  });

  if (txs === null) {
    return (
      <div className="panel">
        <p className="muted">Carregando…</p>
      </div>
    );
  }

  const hasAnything =
    txs.length > 0 || payables.length > 0 || receivables.length > 0 || accounts.length > 0;

  return (
    <>
      {error && <p className="badge err">{error}</p>}

      {/* Situação atual (contas + títulos) */}
      <div className="stat-row">
        <Stat
          label="Saldo atual"
          value={brl(overview.currentBalance)}
          color={overview.currentBalance >= 0 ? "var(--ok)" : "var(--err)"}
        />
        <Stat label="A receber (em aberto)" value={brl(overview.toReceive)} color="var(--ok)" />
        <Stat label="A pagar (em aberto)" value={brl(overview.toPay)} color="var(--err)" />
        <Stat
          label="Saldo projetado"
          value={brl(overview.projectedBalance)}
          color={overview.projectedBalance >= 0 ? "var(--ok)" : "var(--err)"}
        />
      </div>

      {/* Realizados e pendências */}
      <div className="stat-row">
        <Stat label="Receitas realizadas" value={brl(overview.realizedIncome)} color="var(--ok)" />
        <Stat label="Despesas realizadas" value={brl(overview.realizedExpense)} color="var(--err)" />
        <Stat
          label="Vencido (em aberto)"
          value={brl(overview.overdue)}
          color={overview.overdue > 0 ? "var(--err)" : undefined}
        />
        <Stat label="Títulos pendentes" value={String(overview.pendingCount)} />
      </div>

      {!hasAnything && (
        <div className="panel">
          <p className="muted">
            Comece criando uma conta financeira em “Contas financeiras”, depois registre
            lançamentos ou contas a pagar/receber. Tudo aparece aqui automaticamente.
          </p>
        </div>
      )}

      {/* Resultado do mês + Saldos de caixa */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: "1rem",
        }}
      >
        <div className="panel">
          <h2 style={{ marginBottom: 0 }}>Resultado do mês</h2>
          <p className="muted" style={{ marginTop: 2 }}>Situação projetada</p>
          <ChartSwitcher
            storageKey="wq.chart.resultadoMes"
            kinds={["bar", "donut"]}
            items={[
              { label: "Receitas", value: month.income, color: "var(--ok)" },
              { label: "Despesas", value: month.expense, color: "var(--err)" },
            ]}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              borderTop: "1px solid var(--border)",
              paddingTop: "0.6rem",
              marginTop: "0.6rem",
            }}
          >
            <strong>Resultado</strong>
            <strong style={{ color: month.result >= 0 ? "var(--ok)" : "var(--err)" }}>
              {brl(month.result)}
            </strong>
          </div>
        </div>

        <div className="panel">
          <h2>Saldos de caixa</h2>
          {cash.rows.length === 0 ? (
            <p className="muted">Nenhuma conta cadastrada ainda.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Conta</th>
                    <th style={{ textAlign: "right" }}>Confirmado</th>
                    <th style={{ textAlign: "right" }}>Projetado</th>
                  </tr>
                </thead>
                <tbody>
                  {cash.rows.map((r) => (
                    <tr key={r.accountId ?? "none"}>
                      <td>{r.name}</td>
                      <td
                        style={{
                          textAlign: "right",
                          whiteSpace: "nowrap",
                          color: r.confirmed >= 0 ? "var(--ok)" : "var(--err)",
                        }}
                      >
                        {brl(r.confirmed)}
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          whiteSpace: "nowrap",
                          color: r.projected >= 0 ? "var(--ok)" : "var(--err)",
                        }}
                      >
                        {brl(r.projected)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td><strong>Total</strong></td>
                    <td style={{ textAlign: "right" }}><strong>{brl(cash.totalConfirmed)}</strong></td>
                    <td style={{ textAlign: "right" }}><strong>{brl(cash.totalProjected)}</strong></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Fluxo de caixa (projeção) + Resultados de caixa (realizado) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: "1rem",
        }}
      >
        <div className="panel">
          <h2 style={{ marginBottom: 0 }}>Fluxo de caixa</h2>
          <p className="muted" style={{ marginTop: 2 }}>Saldo projetado por mês</p>
          <LineChart points={cashflow.map((m) => ({ label: monthLabel(m.month), value: m.balance }))} />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              borderTop: "1px solid var(--border)",
              paddingTop: "0.6rem",
              marginTop: "0.6rem",
            }}
          >
            <strong>Saldo projetado ao fim</strong>
            <strong style={{ color: projectedEnd >= 0 ? "var(--ok)" : "var(--err)" }}>
              {brl(projectedEnd)}
            </strong>
          </div>
        </div>

        <div className="panel">
          <h2 style={{ marginBottom: 0 }}>Resultados de caixa</h2>
          <p className="muted" style={{ marginTop: 2 }}>Movimentado (realizado)</p>
          <ChartSwitcher
            storageKey="wq.chart.resultadosCaixa"
            kinds={["bar", "donut"]}
            items={[
              { label: "Entradas", value: overview.realizedIncome, color: "var(--ok)" },
              { label: "Saídas", value: overview.realizedExpense, color: "var(--err)" },
            ]}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              borderTop: "1px solid var(--border)",
              paddingTop: "0.6rem",
              marginTop: "0.6rem",
            }}
          >
            <strong>Resultado</strong>
            <strong
              style={{
                color:
                  overview.realizedIncome - overview.realizedExpense >= 0
                    ? "var(--ok)"
                    : "var(--err)",
              }}
            >
              {brl(overview.realizedIncome - overview.realizedExpense)}
            </strong>
          </div>
        </div>
      </div>

      {/* Últimos lançamentos */}
      <div className="panel">
        <h2>Últimos lançamentos</h2>
        {recentTxs.length === 0 ? (
          <p className="muted">
            Nenhum lançamento feito ainda. Lançamentos são registros das suas receitas e despesas.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Descrição</th>
                  <th>Tipo</th>
                  <th style={{ textAlign: "right" }}>Valor</th>
                </tr>
              </thead>
              <tbody>
                {recentTxs.map((t) => (
                  <tr key={t.id}>
                    <td>{brDate(t.date)}</td>
                    <td>{t.description}</td>
                    <td>{TYPE_LABELS[t.type]}</td>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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

      {/* Receitas e Despesas por categoria (situação projetada) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: "1rem",
        }}
      >
        <div className="panel">
          <h2 style={{ marginBottom: 0 }}>Receitas por categoria</h2>
          <p className="muted" style={{ marginTop: 2 }}>Situação projetada</p>
          {receitasCat.length === 0 ? (
            <p className="muted">Sem receitas para exibir.</p>
          ) : (
            <>
              <ChartSwitcher storageKey="wq.chart.receitasCategoria" items={toDonut(receitasCat)} />
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  borderTop: "1px solid var(--border)",
                  paddingTop: "0.6rem",
                  marginTop: "0.6rem",
                }}
              >
                <strong>Total</strong>
                <strong style={{ color: "var(--ok)" }}>
                  {brl(receitasCat.reduce((s, x) => s + x.value, 0))}
                </strong>
              </div>
            </>
          )}
        </div>

        <div className="panel">
          <h2 style={{ marginBottom: 0 }}>Despesas por categoria</h2>
          <p className="muted" style={{ marginTop: 2 }}>Situação projetada</p>
          {despesasCat.length === 0 ? (
            <p className="muted">Sem despesas para exibir.</p>
          ) : (
            <>
              <ChartSwitcher storageKey="wq.chart.despesasCategoria" items={toDonut(despesasCat)} />
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  borderTop: "1px solid var(--border)",
                  paddingTop: "0.6rem",
                  marginTop: "0.6rem",
                }}
              >
                <strong>Total</strong>
                <strong style={{ color: "var(--err)" }}>
                  {brl(despesasCat.reduce((s, x) => s + x.value, 0))}
                </strong>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Resultados por centros (situação projetada) */}
      <div className="panel">
        <h2 style={{ marginBottom: 0 }}>Resultados por centros</h2>
        <p className="muted" style={{ marginTop: 2 }}>Situação projetada</p>
        {centros.length === 0 ? (
          <p className="muted">Nenhum centro de custo com movimento.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Centro</th>
                  <th style={{ textAlign: "right" }}>Receitas</th>
                  <th style={{ textAlign: "right" }}>Despesas</th>
                  <th style={{ textAlign: "right" }}>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {centros.map((c) => (
                  <tr key={c.id ?? "none"}>
                    <td>{c.name}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap", color: "var(--ok)" }}>
                      {c.receitas ? brl(c.receitas) : "—"}
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap", color: "var(--err)" }}>
                      {c.despesas ? `-${brl(c.despesas)}` : "—"}
                    </td>
                    <td
                      style={{
                        textAlign: "right",
                        whiteSpace: "nowrap",
                        color: c.resultado >= 0 ? "var(--ok)" : "var(--err)",
                      }}
                    >
                      {brl(c.resultado)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td><strong>Total</strong></td>
                  <td style={{ textAlign: "right" }}>
                    <strong>{brl(centrosTotal.receitas)}</strong>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <strong>{centrosTotal.despesas ? `-${brl(centrosTotal.despesas)}` : brl(0)}</strong>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <strong style={{ color: centrosTotal.resultado >= 0 ? "var(--ok)" : "var(--err)" }}>
                      {brl(centrosTotal.resultado)}
                    </strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Receitas e Despesas por centro (situação projetada) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: "1rem",
        }}
      >
        <div className="panel">
          <h2 style={{ marginBottom: 0 }}>Receitas por centro</h2>
          <p className="muted" style={{ marginTop: 2 }}>Situação projetada</p>
          {receitasCentro.length === 0 ? (
            <p className="muted">Sem receitas para exibir.</p>
          ) : (
            <>
              <ChartSwitcher storageKey="wq.chart.receitasCentro" items={toDonut(receitasCentro)} />
              <div style={totalRow}>
                <strong>Total</strong>
                <strong style={{ color: "var(--ok)" }}>
                  {brl(receitasCentro.reduce((s, x) => s + x.value, 0))}
                </strong>
              </div>
            </>
          )}
        </div>

        <div className="panel">
          <h2 style={{ marginBottom: 0 }}>Despesas por centro</h2>
          <p className="muted" style={{ marginTop: 2 }}>Situação projetada</p>
          {despesasCentro.length === 0 ? (
            <p className="muted">Sem despesas para exibir.</p>
          ) : (
            <>
              <ChartSwitcher storageKey="wq.chart.despesasCentro" items={toDonut(despesasCentro)} />
              <div style={totalRow}>
                <strong>Total</strong>
                <strong style={{ color: "var(--err)" }}>
                  {brl(despesasCentro.reduce((s, x) => s + x.value, 0))}
                </strong>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Contas a pagar / a receber (em aberto) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: "1rem",
        }}
      >
        <BillListPanel
          title="Contas a pagar"
          kind="payable"
          bills={payables}
          accountName={accountName}
          costCenterName={costCenterName}
        />
        <BillListPanel
          title="Contas a receber"
          kind="receivable"
          bills={receivables}
          accountName={accountName}
          costCenterName={costCenterName}
        />
      </div>

      {/* Lançamentos (movimentos realizados) */}
      <div className="panel">
        <h2>Lançamentos</h2>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
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
          <button
            style={{ background: "var(--border)", marginLeft: "auto" }}
            onClick={exportCsv}
            disabled={filtered.length === 0}
          >
            Exportar CSV
          </button>
        </div>
        {filtered.length === 0 ? (
          <p className="muted">
            {txs.length === 0
              ? "Nenhum lançamento ainda. Use “+ Novo lançamento” acima."
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
                  <th>Conta</th>
                  <th style={{ textAlign: "right" }}>Valor</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.id}>
                    <td>{brDate(t.date)}</td>
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

function BillListPanel({
  title,
  kind,
  bills,
  accountName,
  costCenterName,
}: {
  title: string;
  kind: Bill["kind"];
  bills: Bill[];
  accountName: Map<string, string>;
  costCenterName: Map<string, string>;
}) {
  const open = sortByDueDate(bills.filter((b) => remaining(b) > 0));
  const total = open.reduce((s, b) => s + remaining(b), 0);
  const color = kind === "payable" ? "var(--err)" : "var(--ok)";
  const sign = kind === "payable" ? "-" : "";

  return (
    <div className="panel">
      <h2>{title}</h2>
      {open.length === 0 ? (
        <p className="muted">Nenhuma conta em aberto.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Vencimento</th>
                <th>Descrição</th>
                <th>Centro</th>
                <th>Conta</th>
                <th style={{ textAlign: "right" }}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {open.map((b) => (
                <tr key={b.id}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {brDate(b.dueDate)}
                    {billStatus(b) === "overdue" && (
                      <span className="badge err" style={{ marginLeft: 6 }}>Vencido</span>
                    )}
                  </td>
                  <td>{b.description}</td>
                  <td>{b.costCenterId ? (costCenterName.get(b.costCenterId) ?? "—") : "—"}</td>
                  <td>{b.accountId ? (accountName.get(b.accountId) ?? "—") : "—"}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap", color }}>
                    {sign}
                    {brl(remaining(b))}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}><strong>Total</strong></td>
                <td style={{ textAlign: "right" }}>
                  <strong style={{ color }}>
                    {sign}
                    {brl(total)}
                  </strong>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

const totalRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  borderTop: "1px solid var(--border)",
  paddingTop: "0.6rem",
  marginTop: "0.6rem",
};

const fieldStyle: React.CSSProperties = {
  padding: "0.35rem 0.5rem",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
  font: "inherit",
};
