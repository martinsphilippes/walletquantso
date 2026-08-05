"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LoginGate } from "@/components/LoginGate";
import { useAuth } from "@/services/auth-context";
import { listAccounts, listTransactions } from "@/services/firestore";
import { listBills } from "@/services/bills";
import { projectCashFlow, type CashFlowMonth } from "@/lib/cashflow/project";
import { useColumnFilters, FilterRow, type ColFilterDef } from "@/components/ColumnFilter";
import type { Account, Bill, Transaction } from "@/types";
import { currentMonthBr } from "@/lib/br/date";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const MONTHS = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];
const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS[m - 1]}/${y}`;
};

export default function FluxoPage() {
  return (
    <>
      <h1>Fluxo de caixa</h1>
      <LoginGate>
        <Fluxo />
      </LoginGate>
    </>
  );
}

function Fluxo() {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    setError("");
    setLoading(true);
    try {
      const [a, t, payables, receivables] = await Promise.all([
        listAccounts(user.uid),
        listTransactions(user.uid),
        listBills(user.uid, "payable"),
        listBills(user.uid, "receivable"),
      ]);
      setAccounts(a);
      setTxs(t);
      setBills([...payables, ...receivables]);
    } catch (err) {
      setError(`Falha ao carregar: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const opening = useMemo(
    () => accounts.reduce((s, a) => s + (a.initialBalance ?? 0), 0),
    [accounts],
  );
  const currentMonth = currentMonthBr();

  // Projetado × Realizado (a escolha fica gravada) + recorte de mês/ano.
  const [mode, setMode] = useState<"projected" | "realized">("projected");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("wq.fluxoMode");
      if (saved === "projected" || saved === "realized") setMode(saved);
    } catch {
      /* ignore */
    }
  }, []);
  const chooseMode = (m: "projected" | "realized") => {
    setMode(m);
    try {
      localStorage.setItem("wq.fluxoMode", m);
    } catch {
      /* ignore */
    }
  };
  const [selYear, setSelYear] = useState("");
  const [selMonth, setSelMonth] = useState("");

  const allRows = useMemo(
    () => projectCashFlow(txs, bills, { openingBalance: opening, monthsAhead: 6, mode }),
    [txs, bills, opening, mode],
  );
  const years = useMemo(
    () => [...new Set(allRows.map((r) => r.month.slice(0, 4)))].sort(),
    [allRows],
  );
  const rows = useMemo(
    () =>
      allRows.filter(
        (r) =>
          (!selYear || r.month.slice(0, 4) === selYear) &&
          (!selMonth || r.month.slice(5, 7) === selMonth),
      ),
    [allRows, selYear, selMonth],
  );

  const filterDefs: ColFilterDef<CashFlowMonth>[] = [
    { key: "month", type: "select", value: (r) => monthLabel(r.month) },
    { key: "in", value: (r) => (r.realizedIn ? brl(r.realizedIn) : ""), align: "right" },
    { key: "out", value: (r) => (r.realizedOut ? brl(r.realizedOut) : ""), align: "right" },
    { key: "plannedIn", value: (r) => (r.plannedIn ? brl(r.plannedIn) : ""), align: "right" },
    { key: "plannedOut", value: (r) => (r.plannedOut ? brl(r.plannedOut) : ""), align: "right" },
    { key: "net", value: (r) => brl(r.net), align: "right" },
    { key: "balance", value: (r) => brl(r.balance), align: "right" },
  ];
  const cf = useColumnFilters(rows, filterDefs);

  if (loading) {
    return (
      <div className="panel">
        <p className="muted">Carregando…</p>
      </div>
    );
  }

  return (
    <>
      {error && <p className="badge err">{error}</p>}

      <div className="panel" style={{ padding: "0.75rem 1rem" }}>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ display: "flex", gap: 6 }}>
            {(
              [
                ["projected", "Projetado"],
                ["realized", "Realizado"],
              ] as Array<["projected" | "realized", string]>
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => chooseMode(m)}
                style={{
                  padding: "0.25rem 0.8rem",
                  fontSize: "0.82rem",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  background: mode === m ? "var(--accent)" : "transparent",
                  color: mode === m ? "#fff" : "var(--muted)",
                  cursor: "pointer",
                }}
                aria-pressed={mode === m}
              >
                {label}
              </button>
            ))}
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
            <span className="muted" style={{ fontSize: "0.75rem" }}>Mês</span>
            <select value={selMonth} onChange={(e) => setSelMonth(e.target.value)}>
              <option value="">Todos</option>
              {MONTHS.map((m, i) => (
                <option key={m} value={String(i + 1).padStart(2, "0")}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
            <span className="muted" style={{ fontSize: "0.75rem" }}>Ano</span>
            <select value={selYear} onChange={(e) => setSelYear(e.target.value)}>
              <option value="">Todos</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <button
            style={{ background: "var(--border)" }}
            onClick={() => {
              setSelMonth(currentMonth.slice(5, 7));
              setSelYear(currentMonth.slice(0, 4));
            }}
          >
            Este mês
          </button>
          <button
            style={{ background: "var(--border)" }}
            onClick={() => {
              setSelMonth("");
              setSelYear(currentMonth.slice(0, 4));
            }}
          >
            Este ano
          </button>
          {(selMonth || selYear) && (
            <button
              style={{ background: "var(--border)" }}
              onClick={() => {
                setSelMonth("");
                setSelYear("");
              }}
            >
              Tudo (limpar)
            </button>
          )}
        </div>
      </div>

      <p className="muted">
        Saldo inicial das contas: <strong>{brl(opening)}</strong>.{" "}
        {mode === "projected"
          ? "Projetado: as colunas “Previsto” usam o valor em aberto das contas a pagar e a receber; títulos vencidos e não quitados aparecem no mês atual."
          : "Realizado: somente o dinheiro que de fato entrou e saiu — títulos em aberto não entram, e o saldo é a trajetória real do caixa."}
      </p>

      <div className="panel">
        {rows.length === 0 ? (
          <p className="muted">Sem dados para projetar ainda.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Mês</th>
                  <th style={{ textAlign: "right" }}>Entradas</th>
                  <th style={{ textAlign: "right" }}>Saídas</th>
                  <th style={{ textAlign: "right" }}>Previsto +</th>
                  <th style={{ textAlign: "right" }}>Previsto −</th>
                  <th style={{ textAlign: "right" }}>Resultado</th>
                  <th style={{ textAlign: "right" }}>
                    {mode === "projected" ? "Saldo projetado" : "Saldo realizado"}
                  </th>
                </tr>
                <FilterRow defs={filterDefs} cf={cf} />
              </thead>
              <tbody>
                {cf.filtered.map((r) => {
                  const isCurrent = r.month === currentMonth;
                  return (
                    <tr
                      key={r.month}
                      style={isCurrent ? { background: "var(--bg)", fontWeight: 600 } : undefined}
                    >
                      <td style={{ whiteSpace: "nowrap" }}>
                        {monthLabel(r.month)}
                        {isCurrent && <span className="muted"> (atual)</span>}
                      </td>
                      <td style={{ textAlign: "right", color: r.realizedIn ? "var(--ok)" : undefined }}>
                        {r.realizedIn ? brl(r.realizedIn) : "—"}
                      </td>
                      <td style={{ textAlign: "right", color: r.realizedOut ? "var(--err)" : undefined }}>
                        {r.realizedOut ? brl(r.realizedOut) : "—"}
                      </td>
                      <td style={{ textAlign: "right" }} className="muted">
                        {r.plannedIn ? brl(r.plannedIn) : "—"}
                      </td>
                      <td style={{ textAlign: "right" }} className="muted">
                        {r.plannedOut ? brl(r.plannedOut) : "—"}
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          color: r.net >= 0 ? "var(--ok)" : "var(--err)",
                        }}
                      >
                        {brl(r.net)}
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          fontWeight: 700,
                          color: r.balance >= 0 ? "var(--text)" : "var(--err)",
                        }}
                      >
                        {brl(r.balance)}
                      </td>
                    </tr>
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
