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
import { useColumnFilters, FilterRow, type ColFilterDef } from "@/components/ColumnFilter";
import { useBulkSelect, SelectAllCheckbox, RowCheckbox, BulkBar } from "@/components/BulkSelect";
import { FilterField } from "@/components/FilterField";
import { transactionsToCsv } from "@/lib/export/csv";
import { downloadText } from "@/lib/export/download";
import { filterTransactions, type DashboardFilters } from "@/lib/dashboard/filter";
import { computeOverview } from "@/lib/dashboard/overview";
import { todayBr, currentMonthBr, daysAgoBr, monthRangeBr } from "@/lib/br/date";
import { loadPeriod, savePreset, saveCustomPeriod } from "@/lib/period-presets";
import { computeCashBalances, monthResult, type MonthMode } from "@/lib/dashboard/cash";
import {
  receitasPorCategoria,
  despesasPorCategoria,
  receitasPorCentro,
  despesasPorCentro,
  resultadosPorCentro,
  type Slice,
  type BreakdownMode,
} from "@/lib/dashboard/breakdown";
import { ChartSwitcher, PALETTE } from "@/components/charts";
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
  const [form, setForm] = useState<
    | { mode: "new" }
    | { mode: "edit"; tx: Transaction }
    | { mode: "clone"; tx: Transaction }
    | null
  >(null);
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

  // Período dos indicadores do topo (vazio = histórico inteiro). A última
  // escolha fica gravada e volta aplicada na próxima visita.
  const [dashFrom, setDashFrom] = useState("");
  const [dashTo, setDashTo] = useState("");
  useEffect(() => {
    const p = loadPeriod("wq.dash.period");
    if (p) {
      setDashFrom(p.from);
      setDashTo(p.to);
    }
  }, []);

  const overview = useMemo(
    () =>
      computeOverview(accounts, txs ?? [], payables, receivables, undefined, {
        from: dashFrom || undefined,
        to: dashTo || undefined,
      }),
    [accounts, txs, payables, receivables, dashFrom, dashTo],
  );

  const cash = useMemo(
    () => computeCashBalances(accounts, txs ?? [], payables, receivables),
    [accounts, txs, payables, receivables],
  );

  // Projetada × Realizada no "Resultado do mês" (a escolha fica gravada).
  const [monthMode, setMonthMode] = useState<MonthMode>("projected");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("wq.monthMode") as MonthMode | null;
      if (saved === "projected" || saved === "realized") setMonthMode(saved);
    } catch {
      /* ignore */
    }
  }, []);
  const chooseMonthMode = (m: MonthMode) => {
    setMonthMode(m);
    try {
      localStorage.setItem("wq.monthMode", m);
    } catch {
      /* ignore */
    }
  };

  const month = useMemo(
    () => monthResult(txs ?? [], payables, receivables, undefined, monthMode),
    [txs, payables, receivables, monthMode],
  );

  const recentTxs = useMemo(() => (txs ?? []).slice(0, 5), [txs]);

  // Projetada × Realizada nos painéis de categoria/centro (escolha gravada).
  const [bdMode, setBdMode] = useState<BreakdownMode>("projected");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("wq.breakdownMode") as BreakdownMode | null;
      if (saved === "projected" || saved === "realized") setBdMode(saved);
    } catch {
      /* ignore */
    }
  }, []);
  const chooseBdMode = (m: BreakdownMode) => {
    setBdMode(m);
    try {
      localStorage.setItem("wq.breakdownMode", m);
    } catch {
      /* ignore */
    }
  };

  // Período dos painéis por categoria/centro (vazio = histórico inteiro).
  // Lançamentos entram pela data; títulos, pelo vencimento.
  const [bdFrom, setBdFrom] = useState("");
  const [bdTo, setBdTo] = useState("");
  useEffect(() => {
    const p = loadPeriod("wq.bd.period");
    if (p) {
      setBdFrom(p.from);
      setBdTo(p.to);
    }
  }, []);
  const inBdRange = useCallback(
    (d: string) => (!bdFrom || d >= bdFrom) && (!bdTo || d <= bdTo),
    [bdFrom, bdTo],
  );
  const bdTxs = useMemo(() => (txs ?? []).filter((t) => inBdRange(t.date)), [txs, inBdRange]);
  const bdPayables = useMemo(
    () => payables.filter((b) => inBdRange(b.dueDate)),
    [payables, inBdRange],
  );
  const bdReceivables = useMemo(
    () => receivables.filter((b) => inBdRange(b.dueDate)),
    [receivables, inBdRange],
  );

  const receitasCat = useMemo(
    () => receitasPorCategoria(bdTxs, bdReceivables, categories, bdMode),
    [bdTxs, bdReceivables, categories, bdMode],
  );
  const despesasCat = useMemo(
    () => despesasPorCategoria(bdTxs, bdPayables, categories, bdMode),
    [bdTxs, bdPayables, categories, bdMode],
  );
  const receitasCentro = useMemo(
    () => receitasPorCentro(bdTxs, bdReceivables, costCenters, bdMode),
    [bdTxs, bdReceivables, costCenters, bdMode],
  );
  const despesasCentro = useMemo(
    () => despesasPorCentro(bdTxs, bdPayables, costCenters, bdMode),
    [bdTxs, bdPayables, costCenters, bdMode],
  );
  const centros = useMemo(
    () => resultadosPorCentro(bdTxs, bdPayables, bdReceivables, costCenters, bdMode),
    [bdTxs, bdPayables, bdReceivables, costCenters, bdMode],
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

  const filtered = useMemo(
    () => (txs ? filterTransactions(txs, filters) : []),
    [txs, filters],
  );

  const set = (patch: Partial<DashboardFilters>) =>
    setFilters((prev) => ({ ...prev, ...patch }));

  const nameOfAccount = (id?: string | null) =>
    id ? (accountName.get(id) ?? id) : "—";

  const colDefs: ColFilterDef<Transaction>[] = [
    { key: "select", type: "none" },
    { key: "date", value: (t) => brDate(t.date) },
    { key: "description", value: (t) => t.description },
    { key: "type", type: "select", value: (t) => TYPE_LABELS[t.type] },
    { key: "category", type: "select", value: (t) => (t.categoryId ? (categoryName.get(t.categoryId) ?? "") : "") },
    {
      key: "account",
      type: "select",
      value: (t) =>
        t.type === "transfer"
          ? `${nameOfAccount(t.accountId)} → ${nameOfAccount(t.transferAccountId)}`
          : nameOfAccount(t.accountId),
    },
    { key: "amount", value: (t) => brl(t.amount), align: "right" },
    { key: "actions", type: "none" },
  ];
  const cf = useColumnFilters(filtered, colDefs);
  const sel = useBulkSelect(cf.filtered, (t) => t.id);

  async function handleBulkDelete() {
    if (!user || sel.count === 0) return;
    setError("");
    try {
      for (const id of sel.selectedIds) await removeTransaction(user.uid, id);
      sel.clear();
      await load();
    } catch (err) {
      setError(`Falha ao excluir: ${(err as Error).message}`);
    }
  }

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
      if (form?.mode === "edit") {
        await updateTransaction(user.uid, form.tx.id!, input);
        setForm(null);
      } else if (form?.mode === "clone") {
        // Clone: create a brand-new lançamento from the copied data and close.
        await createTransaction(user.uid, input);
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

      {/* Período dos indicadores do topo */}
      <div className="panel" style={{ padding: "0.75rem 1rem" }}>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-end" }}>
          <strong style={{ alignSelf: "center" }}>Período dos indicadores</strong>
          <FilterField label="Data inicial (de)">
            <input
              type="date"
              value={dashFrom}
              onChange={(e) => {
                setDashFrom(e.target.value);
                saveCustomPeriod("wq.dash.period", e.target.value, dashTo);
              }}
              style={fieldStyle}
            />
          </FilterField>
          <FilterField label="Data final (até)">
            <input
              type="date"
              value={dashTo}
              onChange={(e) => {
                setDashTo(e.target.value);
                saveCustomPeriod("wq.dash.period", dashFrom, e.target.value);
              }}
              style={fieldStyle}
            />
          </FilterField>
          <button
            style={{ background: "var(--border)" }}
            onClick={() => {
              setDashFrom(`${currentMonthBr()}-01`);
              setDashTo(todayBr());
              savePreset("wq.dash.period", "thisMonthToToday");
            }}
          >
            Este mês
          </button>
          <button
            style={{ background: "var(--border)" }}
            onClick={() => {
              setDashFrom(daysAgoBr(30));
              setDashTo(todayBr());
              savePreset("wq.dash.period", "days30");
            }}
          >
            Últimos 30 dias
          </button>
          {(dashFrom || dashTo) && (
            <button
              style={{ background: "var(--border)" }}
              onClick={() => {
                setDashFrom("");
                setDashTo("");
                savePreset("wq.dash.period", "all");
              }}
            >
              Tudo (limpar)
            </button>
          )}
        </div>
        {(dashFrom || dashTo) && (
          <p className="muted" style={{ marginBottom: 0, fontSize: "0.82rem" }}>
            Receitas/despesas realizadas <strong>no período</strong>; a pagar/receber e
            pendentes que <strong>vencem no período</strong>; saldo atual{" "}
            <strong>até a data final</strong>.
          </p>
        )}
      </div>

      {/* Situação atual (contas + títulos) */}
      <div className="stat-row">
        <Stat
          label="Saldo atual (todas as contas)"
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
          <div style={{ display: "flex", gap: 6, margin: "6px 0 10px" }}>
            {(
              [
                ["projected", "Projetada"],
                ["realized", "Realizada"],
              ] as Array<[MonthMode, string]>
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => chooseMonthMode(m)}
                style={{
                  padding: "0.2rem 0.7rem",
                  fontSize: "0.78rem",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  background: monthMode === m ? "var(--accent)" : "transparent",
                  color: monthMode === m ? "var(--accent-ink)" : "var(--muted)",
                  cursor: "pointer",
                }}
                aria-pressed={monthMode === m}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="muted" style={{ marginTop: 0, fontSize: "0.8rem" }}>
            {monthMode === "projected"
              ? "Projetada: o realizado + títulos em aberto que vencem no mês."
              : "Realizada: somente o que de fato entrou e saiu no mês."}
          </p>
          <ChartSwitcher
            storageKey="wq.chart.resultadoMes"
            kinds={["bar", "hbar", "donut"]}
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

      {/* Resultados de caixa (realizado) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: "1rem",
        }}
      >
        <div className="panel">
          <h2 style={{ marginBottom: 0 }}>Resultados de caixa</h2>
          <p className="muted" style={{ marginTop: 2 }}>Movimentado (realizado)</p>
          <ChartSwitcher
            storageKey="wq.chart.resultadosCaixa"
            kinds={["bar", "hbar", "donut"]}
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
          initial={form.mode === "new" ? undefined : txToInput(form.tx)}
          submitLabel={
            form.mode === "edit"
              ? "Salvar alterações"
              : form.mode === "clone"
                ? "Duplicar lançamento"
                : "Adicionar lançamento"
          }
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

      {/* Período dos painéis por categoria/centro */}
      <div className="panel" style={{ padding: "0.75rem 1rem" }}>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-end" }}>
          <strong style={{ alignSelf: "center" }}>Período dos gráficos</strong>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignSelf: "center" }}>
            {(() => {
              const presets: Array<{ label: string; preset: string; from: string; to: string }> = [
                { label: "Este mês", preset: "month0", ...monthRangeBr(0) },
                { label: "Mês passado", preset: "month-1", ...monthRangeBr(-1) },
                { label: "Próximo mês", preset: "month+1", ...monthRangeBr(1) },
                { label: "30 dias", preset: "days30", from: daysAgoBr(30), to: todayBr() },
                { label: "60 dias", preset: "days60", from: daysAgoBr(60), to: todayBr() },
                { label: "90 dias", preset: "days90", from: daysAgoBr(90), to: todayBr() },
              ];
              const chip = (active: boolean): React.CSSProperties => ({
                padding: "0.25rem 0.75rem",
                fontSize: "0.8rem",
                borderRadius: 999,
                border: "1px solid var(--border)",
                background: active ? "var(--accent)" : "transparent",
                color: active ? "var(--accent-ink)" : "var(--muted)",
                cursor: "pointer",
              });
              return (
                <>
                  {presets.map((p) => {
                    const active = bdFrom === p.from && bdTo === p.to;
                    return (
                      <button
                        key={p.label}
                        type="button"
                        style={chip(active)}
                        onClick={() => {
                          setBdFrom(p.from);
                          setBdTo(p.to);
                          savePreset("wq.bd.period", p.preset);
                        }}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    style={chip(!bdFrom && !bdTo)}
                    onClick={() => {
                      setBdFrom("");
                      setBdTo("");
                      savePreset("wq.bd.period", "all");
                    }}
                  >
                    Tudo
                  </button>
                </>
              );
            })()}
          </div>
          <FilterField label="Data inicial (de)">
            <input
              type="date"
              value={bdFrom}
              onChange={(e) => {
                setBdFrom(e.target.value);
                saveCustomPeriod("wq.bd.period", e.target.value, bdTo);
              }}
              style={fieldStyle}
            />
          </FilterField>
          <FilterField label="Data final (até)">
            <input
              type="date"
              value={bdTo}
              onChange={(e) => {
                setBdTo(e.target.value);
                saveCustomPeriod("wq.bd.period", bdFrom, e.target.value);
              }}
              style={fieldStyle}
            />
          </FilterField>
        </div>
        <p className="muted" style={{ marginBottom: 0, fontSize: "0.82rem" }}>
          Vale para os painéis abaixo (por categoria e por centro): lançamentos pela data,
          títulos pelo vencimento.
        </p>
      </div>

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
          <BreakdownToggle mode={bdMode} onChange={chooseBdMode} />
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
          <BreakdownToggle mode={bdMode} onChange={chooseBdMode} />
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
        <BreakdownToggle mode={bdMode} onChange={chooseBdMode} />
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
          <BreakdownToggle mode={bdMode} onChange={chooseBdMode} />
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
          <BreakdownToggle mode={bdMode} onChange={chooseBdMode} />
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
        <div
          style={{
            display: "flex",
            gap: "0.75rem",
            flexWrap: "wrap",
            marginBottom: "0.75rem",
            alignItems: "flex-end",
          }}
        >
          <FilterField label="Buscar descrição">
            <input
              placeholder="Ex.: aluguel, pix…"
              value={filters.text ?? ""}
              onChange={(e) => set({ text: e.target.value })}
              style={fieldStyle}
            />
          </FilterField>
          <FilterField label="Conta">
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
          </FilterField>
          <FilterField label="Tipo">
            <select
              value={filters.type ?? ""}
              onChange={(e) => set({ type: (e.target.value || "") as TransactionType | "" })}
            >
              <option value="">Todos os tipos</option>
              <option value="income">Receita</option>
              <option value="expense">Despesa</option>
              <option value="transfer">Transferência</option>
            </select>
          </FilterField>
          <FilterField label="Data inicial (de)">
            <input
              type="date"
              value={filters.from ?? ""}
              onChange={(e) => set({ from: e.target.value || undefined })}
              style={fieldStyle}
            />
          </FilterField>
          <FilterField label="Data final (até)">
            <input
              type="date"
              value={filters.to ?? ""}
              onChange={(e) => set({ to: e.target.value || undefined })}
              style={fieldStyle}
            />
          </FilterField>
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
        <BulkBar sel={sel} onDelete={handleBulkDelete} noun="lançamento" />
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
                  <th style={{ width: 32 }}><SelectAllCheckbox sel={sel} /></th>
                  <th>Data</th>
                  <th>Descrição</th>
                  <th>Tipo</th>
                  <th>Categoria</th>
                  <th>Conta</th>
                  <th style={{ textAlign: "right" }}>Valor</th>
                  <th></th>
                </tr>
                <FilterRow defs={colDefs} cf={cf} />
              </thead>
              <tbody>
                {cf.filtered.map((t) => (
                  <tr key={t.id}>
                    <td><RowCheckbox sel={sel} id={t.id} /></td>
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
                        style={{ background: "var(--border)", padding: "0.3rem 0.6rem" }}
                        onClick={() => {
                          setForm({ mode: "clone", tx: t });
                          if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                      >
                        Clonar
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

/** Pill pair + subtitle used by the category/center breakdown panels. */
function BreakdownToggle({
  mode,
  onChange,
}: {
  mode: BreakdownMode;
  onChange: (m: BreakdownMode) => void;
}) {
  return (
    <div style={{ margin: "4px 0 8px" }}>
      <div style={{ display: "flex", gap: 6 }}>
        {(
          [
            ["projected", "Projetada"],
            ["realized", "Realizada"],
          ] as Array<[BreakdownMode, string]>
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            style={{
              padding: "0.15rem 0.65rem",
              fontSize: "0.75rem",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: mode === m ? "var(--accent)" : "transparent",
              color: mode === m ? "var(--accent-ink)" : "var(--muted)",
              cursor: "pointer",
            }}
            aria-pressed={mode === m}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="muted" style={{ margin: "4px 0 0", fontSize: "0.78rem" }}>
        {mode === "projected"
          ? "Situação projetada (realizado + títulos em aberto)"
          : "Situação realizada (somente o que movimentou)"}
      </p>
    </div>
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
