"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LoginGate } from "@/components/LoginGate";
import { useAuth } from "@/services/auth-context";
import { listCategories, listTransactions } from "@/services/firestore";
import {
  monthsPresent,
  totalsByCategory,
  totalsByMonth,
  type MonthTotal,
} from "@/lib/reports/aggregate";
import { useColumnFilters, FilterRow, type ColFilterDef } from "@/components/ColumnFilter";
import { FilterField } from "@/components/FilterField";
import { DonutChart, CumulativeChart, PALETTE, type DonutItem } from "@/components/charts";
import { toCsv, brNumber } from "@/lib/export/csv";
import { downloadText } from "@/lib/export/download";
import type { Category, Transaction, TransactionType } from "@/types";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const monthLabel = (m: string) => {
  const [y, mo] = m.split("-");
  const names = [
    "jan", "fev", "mar", "abr", "mai", "jun",
    "jul", "ago", "set", "out", "nov", "dez",
  ];
  return `${names[Number(mo) - 1]}/${y}`;
};

export default function ReportsPage() {
  return (
    <>
      <h1>Relatórios</h1>
      <LoginGate>
        <Reports />
      </LoginGate>
    </>
  );
}

function Reports() {
  const { user } = useAuth();
  const [txs, setTxs] = useState<Transaction[] | null>(null);
  const [catName, setCatName] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState("");
  const [type, setType] = useState<TransactionType>("expense");
  const [month, setMonth] = useState<string>("");

  const load = useCallback(async () => {
    if (!user) return;
    setError("");
    try {
      const [t, c] = await Promise.all([listTransactions(user.uid), listCategories(user.uid)]);
      setTxs(t);
      setCatName(new Map(c.map((x: Category) => [x.id!, x.name])));
    } catch (err) {
      setError(`Falha ao carregar: ${(err as Error).message}`);
      setTxs([]);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const months = useMemo(() => (txs ? monthsPresent(txs) : []), [txs]);
  const byMonth = useMemo(() => (txs ? totalsByMonth(txs) : []), [txs]);
  const monthMax = useMemo(
    () => Math.max(1, ...byMonth.flatMap((m) => [m.income, m.expense])),
    [byMonth],
  );

  const monthDefs: ColFilterDef<MonthTotal>[] = [
    { key: "month", type: "select", value: (m) => monthLabel(m.month) },
    { key: "bars", type: "none" },
    { key: "balance", value: (m) => brl(m.balance), align: "right" },
  ];
  const monthCf = useColumnFilters(byMonth, monthDefs);

  const scoped = useMemo(
    () => (txs ? (month ? txs.filter((t) => t.date.startsWith(month)) : txs) : []),
    [txs, month],
  );
  const byCategory = useMemo(() => totalsByCategory(scoped, type), [scoped, type]);
  const categoryTotal = useMemo(
    () => byCategory.reduce((s, c) => s + c.total, 0),
    [byCategory],
  );
  const categoryMax = Math.max(1, ...byCategory.map((c) => c.total));

  const donutItems: DonutItem[] = useMemo(() => {
    const named = byCategory.map((c) => ({
      label: c.categoryId ? (catName.get(c.categoryId) ?? "?") : "Sem categoria",
      value: c.total,
    }));
    const top = named.slice(0, 7).map((t, i) => ({ ...t, color: PALETTE[i % PALETTE.length] }));
    const rest = named.slice(7);
    if (rest.length) {
      top.push({
        label: `Outros (${rest.length})`,
        value: rest.reduce((s, r) => s + r.value, 0),
        color: PALETTE[7],
      });
    }
    return top;
  }, [byCategory, catName]);

  function exportCategoryCsv() {
    const header = ["Categoria", "Valor", "Percentual"];
    const rows = byCategory.map((c) => {
      const name = c.categoryId ? (catName.get(c.categoryId) ?? "?") : "Sem categoria";
      const pct = categoryTotal ? ((c.total / categoryTotal) * 100).toFixed(1) : "0";
      return [name, brNumber(c.total), `${pct}%`];
    });
    const scope = month || "todos";
    downloadText(`walletquantso-categorias-${type}-${scope}.csv`, toCsv([header, ...rows]));
  }

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

      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <button style={{ background: "var(--border)" }} onClick={() => window.print()}>
          Imprimir / salvar PDF
        </button>
        <button
          style={{ background: "var(--border)" }}
          onClick={exportCategoryCsv}
          disabled={byCategory.length === 0}
        >
          Exportar CSV (categorias)
        </button>
      </div>

      <div className="panel">
        <h2>Receitas x Despesas por mês</h2>
        {byMonth.length === 0 ? (
          <p className="muted">Sem dados ainda.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Mês</th>
                <th style={{ width: "50%" }}>Receita / Despesa</th>
                <th style={{ textAlign: "right" }}>Saldo</th>
              </tr>
              <FilterRow defs={monthDefs} cf={monthCf} />
            </thead>
            <tbody>
              {monthCf.filtered.map((m) => (
                <tr key={m.month}>
                  <td>{monthLabel(m.month)}</td>
                  <td>
                    <Bar value={m.income} max={monthMax} color="var(--ok)" label={brl(m.income)} />
                    <Bar
                      value={m.expense}
                      max={monthMax}
                      color="var(--err)"
                      label={brl(m.expense)}
                    />
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      fontWeight: 700,
                      color: m.balance >= 0 ? "var(--ok)" : "var(--err)",
                    }}
                  >
                    {brl(m.balance)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {byMonth.length > 0 && (
          <>
            <h3 style={{ marginTop: "1.5rem" }}>Evolução do saldo acumulado</h3>
            <CumulativeChart months={byMonth} />
          </>
        )}
      </div>

      <div className="panel">
        <h2>Por categoria</h2>
        <div
          style={{
            display: "flex",
            gap: "0.75rem",
            flexWrap: "wrap",
            marginBottom: "1rem",
            alignItems: "flex-end",
          }}
        >
          <FilterField label="Tipo">
            <select value={type} onChange={(e) => setType(e.target.value as TransactionType)}>
              <option value="expense">Despesas</option>
              <option value="income">Receitas</option>
            </select>
          </FilterField>
          <FilterField label="Mês">
            <select value={month} onChange={(e) => setMonth(e.target.value)}>
              <option value="">Todos os meses</option>
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          </FilterField>
          <span className="muted" style={{ alignSelf: "center" }}>
            Total: <strong>{brl(categoryTotal)}</strong>
          </span>
        </div>

        {byCategory.length === 0 ? (
          <p className="muted">Nenhum lançamento neste filtro.</p>
        ) : (
          <>
          <div style={{ marginBottom: "1.5rem" }}>
            <DonutChart items={donutItems} />
          </div>
          <table>
            <tbody>
              {byCategory.map((c) => {
                const name = c.categoryId ? (catName.get(c.categoryId) ?? "?") : "Sem categoria";
                const pct = categoryTotal ? (c.total / categoryTotal) * 100 : 0;
                return (
                  <tr key={c.categoryId ?? "__none__"}>
                    <td style={{ width: 180 }}>{name}</td>
                    <td>
                      <Bar value={c.total} max={categoryMax} color="var(--accent)" />
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {brl(c.total)}{" "}
                      <span className="muted">({pct.toFixed(1)}%)</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </>
        )}
      </div>
    </>
  );
}

function Bar({
  value,
  max,
  color,
  label,
}: {
  value: number;
  max: number;
  color: string;
  label?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", margin: "2px 0" }}>
      <div className="bar-track" style={{ flex: 1 }}>
        <div className="bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      {label && (
        <span className="muted" style={{ fontSize: "0.8rem", minWidth: 90, textAlign: "right" }}>
          {label}
        </span>
      )}
    </div>
  );
}
