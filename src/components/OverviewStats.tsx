"use client";

// Indicadores do topo (situação atual + realizados/pendências) e o quadro
// "Saldos de caixa" por conta — os mesmos do Dashboard, compartilhados com
// Lançamentos. Os números vêm de computeOverview/computeCashBalances; aqui é
// só a apresentação.

import { brl } from "@/lib/br/money";
import type { FinancialOverview } from "@/lib/dashboard/overview";
import type { CashBalances } from "@/lib/dashboard/cash";
import { PanelHead } from "@/components/PanelHead";

export function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="stat">
      <div className="n" style={{ fontSize: "1.2rem", ...(color ? { color } : {}) }}>
        {value}
      </div>
      <div className="muted">{label}</div>
    </div>
  );
}

/** Os oito cartões: saldo atual, a receber, a pagar, projetado; realizados, vencido, pendentes. */
export function OverviewCards({ overview }: { overview: FinancialOverview }) {
  return (
    <>
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
    </>
  );
}

/** Quadro "Saldos de caixa": confirmado e projetado por conta, com total. */
export function CashBalancesPanel({ cash, panelId = "saldos" }: { cash: CashBalances; panelId?: string }) {
  const money = (n: number) => (
    <td style={{ textAlign: "right", whiteSpace: "nowrap", color: n >= 0 ? "var(--ok)" : "var(--err)" }}>
      {brl(n)}
    </td>
  );
  return (
    <div className="panel">
      <PanelHead id={panelId} title="Saldos de caixa" />
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
                  {money(r.confirmed)}
                  {money(r.projected)}
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
  );
}
