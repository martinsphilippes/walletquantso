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
  const rows = useMemo(
    () => projectCashFlow(txs, bills, { openingBalance: opening, monthsAhead: 6 }),
    [txs, bills, opening],
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

      <p className="muted">
        Saldo inicial das contas: <strong>{brl(opening)}</strong>. As colunas
        “Previsto” usam o valor em aberto das contas a pagar e a receber; títulos
        vencidos e não quitados aparecem no mês atual.
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
                  <th style={{ textAlign: "right" }}>Saldo projetado</th>
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
