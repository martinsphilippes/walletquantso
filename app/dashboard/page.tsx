"use client";

import { brl } from "@/lib/br/money";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { maskBrAmount, parseBrCurrency } from "@/lib/br/parse";
import { FEE_AUTO, FeeFields, resolveFee, type FeeState } from "@/components/FeeFields";
import { loadErrorMessage } from "@/lib/errors";
import { LoginGate } from "@/components/LoginGate";
import { useAuth } from "@/services/auth-context";
import {
  listAccounts,
  listCategories,
  listContacts,
  listCostCenters,
  listTransactions,
} from "@/services/firestore";
import { addPayment, listBills } from "@/services/bills";
import { onListsChange } from "@/services/live-store";
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
import { DatePicker } from "@/components/DatePicker";
import { PanelHead } from "@/components/PanelHead";
import { OverviewCards, CashBalancesPanel } from "@/components/OverviewStats";
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

/** Id de baixa (único dentro do título). */
const rid = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`);


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
      setError(`Falha ao carregar: ${loadErrorMessage(err)}`);
      setTxs([]);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  // Recarrega sozinho quando os dados mudam (ex.: lançamento feito no celular
  // aparece no Dashboard aberto do iPad sem precisar recarregar).
  useEffect(() => onListsChange(() => { void load(); }), [load]);

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
  // Taxa e gastos vinculados (ex.: L-BTC) de cada lançamento, achados pelo id.
  const txById = useMemo(
    () => new Map((txs ?? []).filter((t) => t.id).map((t) => [t.id as string, t])),
    [txs],
  );

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

  // Edição: a taxa existente vem junto (ou nenhuma); clone recalcula pela conta.
  const txToInput = (t: Transaction, mode: "edit" | "clone" = "clone"): Partial<TransactionInput> => ({
    ...(mode === "edit"
      ? { fee: t.feeTransactionId ? { accountId: "", amount: t.feeAmount ?? 0 } : null }
      : {}),
    date: t.date,
    amount: t.feeGross ?? t.amount,
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
            <DatePicker
              value={dashFrom}
              allowEmpty
              onChange={(iso) => {
                setDashFrom(iso);
                saveCustomPeriod("wq.dash.period", iso, dashTo);
              }}
            />
          </FilterField>
          <FilterField label="Data final (até)">
            <DatePicker
              value={dashTo}
              allowEmpty
              onChange={(iso) => {
                setDashTo(iso);
                saveCustomPeriod("wq.dash.period", dashFrom, iso);
              }}
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

      {/* Situação atual, realizados e pendências (os mesmos de Lançamentos) */}
      <OverviewCards overview={overview} />

      {!hasAnything && (
        <div className="panel">
          <p className="muted">
            Comece criando uma conta financeira em “Contas financeiras”, depois registre
            lançamentos ou contas a pagar/receber. Tudo aparece aqui automaticamente.
          </p>
        </div>
      )}

      {/* Saldos de caixa (largura inteira) */}
      <CashBalancesPanel cash={cash} />

      {/* Resultado do mês + Resultados de caixa, lado a lado */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: "1rem",
        }}
      >
        <div className="panel">
          <PanelHead id="resultado-mes" title="Resultado do mês" />
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
          <PanelHead id="resultados-caixa" title="Resultados de caixa" />
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
        <PanelHead id="ultimos" title="Últimos lançamentos" />
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
                      {(t.feeAmount ?? 0) > 0 && (
                        <div className="muted" style={{ fontSize: "0.72rem", fontWeight: 400 }}>
                          + taxa {brl(t.feeAmount!)}
                        </div>
                      )}
                      {(t.linkedFeeTransactionIds ?? [])
                        .map((id) => txById.get(id))
                        .filter((l): l is Transaction => !!l)
                        .map((l) => (
                          <div key={l.id} className="muted" style={{ fontSize: "0.72rem", fontWeight: 400 }}>
                            + {nameOfAccount(l.accountId)} {brl(l.amount)}
                          </div>
                        ))}
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
          initial={form.mode === "new" ? undefined : txToInput(form.tx, form.mode === "edit" ? "edit" : "clone")}
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
            <DatePicker
              value={bdFrom}
              allowEmpty
              onChange={(iso) => {
                setBdFrom(iso);
                saveCustomPeriod("wq.bd.period", iso, bdTo);
              }}
            />
          </FilterField>
          <FilterField label="Data final (até)">
            <DatePicker
              value={bdTo}
              allowEmpty
              onChange={(iso) => {
                setBdTo(iso);
                saveCustomPeriod("wq.bd.period", bdFrom, iso);
              }}
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
          <PanelHead id="rec-categoria" title="Receitas por categoria" />
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
          <PanelHead id="desp-categoria" title="Despesas por categoria" />
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
        <PanelHead id="centros" title="Resultados por centros" />
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
          <PanelHead id="rec-centro" title="Receitas por centro" />
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
          <PanelHead id="desp-centro" title="Despesas por centro" />
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
          accounts={accounts}
          accountName={accountName}
          costCenterName={costCenterName}
          onChanged={load}
        />
        <BillListPanel
          title="Contas a receber"
          kind="receivable"
          bills={receivables}
          accounts={accounts}
          accountName={accountName}
          costCenterName={costCenterName}
          onChanged={load}
        />
      </div>

      {/* Lançamentos (movimentos realizados) */}
      <div className="panel">
        <PanelHead id="lancamentos" title="Lançamentos" />
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
            <DatePicker value={filters.from ?? ""} allowEmpty onChange={(iso) => set({ from: iso || undefined })} />
          </FilterField>
          <FilterField label="Data final (até)">
            <DatePicker value={filters.to ?? ""} allowEmpty onChange={(iso) => set({ to: iso || undefined })} />
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

/**
 * Painel de contas em aberto do Dashboard, com baixa direto na linha: o botão
 * Pagar/Receber abre valor, data, conta e a taxa da conta (ex.: Depix e o
 * gasto L-BTC), e "Confirmar" quita o título pelo valor informado — a mesma
 * baixa de Contas a pagar/receber (vira lançamento e sai da lista).
 */
function BillListPanel({
  title,
  kind,
  bills,
  accounts,
  accountName,
  costCenterName,
  onChanged,
}: {
  title: string;
  kind: Bill["kind"];
  bills: Bill[];
  accounts: Account[];
  accountName: Map<string, string>;
  costCenterName: Map<string, string>;
  /** Recarrega os dados depois de uma baixa. */
  onChanged: () => Promise<void>;
}) {
  const open = sortByDueDate(bills.filter((b) => remaining(b) > 0));
  const total = open.reduce((s, b) => s + remaining(b), 0);
  const isPayable = kind === "payable";
  const color = isPayable ? "var(--err)" : "var(--ok)";
  const sign = isPayable ? "-" : "";
  const verb = isPayable ? "Pagar" : "Receber";
  const txType: TransactionType = isPayable ? "expense" : "income";

  const [payingId, setPayingId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState(todayBr());
  const [payAccount, setPayAccount] = useState("");
  const [payFee, setPayFee] = useState<FeeState>(FEE_AUTO);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  function startPay(b: Bill) {
    setPayingId(b.id!);
    setPayAmount(
      remaining(b).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    );
    setPayDate(todayBr());
    setPayAccount(b.accountId ?? "");
    setPayFee(FEE_AUTO);
    setMsg("");
  }

  async function confirmPay(b: Bill) {
    const amount = parseBrCurrency(payAmount);
    if (amount == null || amount <= 0) {
      setMsg("❌ Informe um valor maior que zero.");
      return;
    }
    const account = payAccount || b.accountId || "";
    if (!account) {
      setMsg("❌ Escolha a conta da baixa.");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const decision = resolveFee(txType, account, null, amount, accounts, payFee);
      await addPayment(
        b.id!,
        { id: rid(), date: payDate || todayBr(), amount, accountId: account },
        { settle: true, fee: decision ? { amount: decision.amount, learn: decision.learn } : undefined },
      );
      setPayingId(null);
      await onChanged();
      setMsg(`✅ ${isPayable ? "Pago" : "Recebido"} ${brl(amount)} — ${b.description}.`);
    } catch (err) {
      setMsg(`❌ Falha ao ${isPayable ? "pagar" : "receber"}: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const mini: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 3, fontSize: "0.72rem" };

  return (
    <div className="panel">
      <PanelHead id={`bills-${kind}`} title={title} />
      {msg && (
        <p style={{ fontSize: "0.8rem", color: msg.startsWith("❌") ? "var(--err)" : "var(--ok)", marginTop: 0 }}>
          {msg}
        </p>
      )}
      {open.length === 0 ? (
        <p className="muted">Nenhuma conta em aberto.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="dense">
            <thead>
              <tr>
                <th>Venc.</th>
                <th>Descrição</th>
                <th>Centro</th>
                <th>Conta</th>
                <th style={{ textAlign: "right" }}>Valor</th>
                <th aria-label="Ações" />
              </tr>
            </thead>
            <tbody>
              {open.map((b) => (
                <Fragment key={b.id}>
                  <tr>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {brDate(b.dueDate)}
                      {billStatus(b) === "overdue" && (
                        <div>
                          <span className="badge err">Vencido</span>
                        </div>
                      )}
                    </td>
                    <td>{b.description}</td>
                    <td>{b.costCenterId ? (costCenterName.get(b.costCenterId) ?? "—") : "—"}</td>
                    <td>{b.accountId ? (accountName.get(b.accountId) ?? "—") : "—"}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap", color, fontWeight: 600 }}>
                      {sign}
                      {brl(remaining(b))}
                    </td>
                    <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                      <button
                        className={payingId === b.id ? undefined : "btn-primary"}
                        disabled={busy}
                        onClick={() => (payingId === b.id ? setPayingId(null) : startPay(b))}
                        style={payingId === b.id ? { background: "var(--border)" } : undefined}
                      >
                        {payingId === b.id ? "Fechar" : verb}
                      </button>
                    </td>
                  </tr>
                  {payingId === b.id && (
                    <tr>
                      <td colSpan={6} style={{ background: "var(--bg)", padding: "0.5rem 0.6rem" }}>
                        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "flex-end" }}>
                          <label style={mini}>
                            <span className="muted">Valor (R$)</span>
                            <input
                              value={payAmount}
                              onChange={(e) => setPayAmount(maskBrAmount(e.target.value))}
                              inputMode="numeric"
                              style={{ ...fieldStyle, width: 110, textAlign: "right", fontWeight: 700 }}
                            />
                          </label>
                          <div style={mini}>
                            <span className="muted">Data</span>
                            <DatePicker value={payDate} onChange={setPayDate} ariaLabel="Data da baixa" />
                          </div>
                          <label style={mini}>
                            <span className="muted">Conta</span>
                            <select
                              value={payAccount}
                              onChange={(e) => {
                                setPayAccount(e.target.value);
                                setPayFee(FEE_AUTO);
                              }}
                              style={fieldStyle}
                            >
                              <option value="">Escolha…</option>
                              {accounts.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button className="btn-primary" disabled={busy} onClick={() => void confirmPay(b)}>
                            {busy ? "Salvando…" : `Confirmar ${verb.toLowerCase()}`}
                          </button>
                          <button style={{ background: "var(--border)" }} disabled={busy} onClick={() => setPayingId(null)}>
                            Cancelar
                          </button>
                          <span className="muted" style={{ fontSize: "0.72rem", flexBasis: "100%" }}>
                            Quita o título pelo valor informado: ele sai desta lista e vira um lançamento na conta.
                          </span>
                          <FeeFields
                            compact
                            type={txType}
                            accountId={payAccount || b.accountId || ""}
                            gross={parseBrCurrency(payAmount) ?? 0}
                            accounts={accounts}
                            state={payFee}
                            onChange={setPayFee}
                          />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
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
                <td />
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
