"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LoginGate } from "@/components/LoginGate";
import { useAuth } from "@/services/auth-context";
import { listAccounts, listTransactions } from "@/services/firestore";
import { setReconciled } from "@/services/transactions";
import {
  movementFor,
  transactionsForAccount,
  summarizeClearing,
} from "@/lib/reconcile/clearing";
import type { Account, Transaction } from "@/types";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const brDate = (iso: string) => iso.split("-").reverse().join("/");

export default function ConciliacaoPage() {
  return (
    <>
      <h1>Conciliação</h1>
      <LoginGate>
        <Conciliacao />
      </LoginGate>
    </>
  );
}

function Conciliacao() {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [accountId, setAccountId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [onlyPending, setOnlyPending] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setError("");
    setLoading(true);
    try {
      const [a, t] = await Promise.all([listAccounts(user.uid), listTransactions(user.uid)]);
      setAccounts(a);
      setTxs(t);
      setAccountId((cur) => cur || a[0]?.id || "");
    } catch (err) {
      setError(`Falha ao carregar: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const account = useMemo(
    () => accounts.find((a) => a.id === accountId),
    [accounts, accountId],
  );
  const accountTxs = useMemo(
    () => (accountId ? transactionsForAccount(txs, accountId) : []),
    [txs, accountId],
  );
  const summary = useMemo(
    () => (account ? summarizeClearing(account, accountTxs) : null),
    [account, accountTxs],
  );
  const visible = useMemo(
    () => (onlyPending ? accountTxs.filter((t) => !t.reconciled) : accountTxs),
    [accountTxs, onlyPending],
  );

  async function toggle(t: Transaction) {
    if (!t.id) return;
    setPendingId(t.id);
    setError("");
    // Optimistic update.
    setTxs((prev) =>
      prev.map((x) => (x.id === t.id ? { ...x, reconciled: !x.reconciled } : x)),
    );
    try {
      await setReconciled(t.id, !t.reconciled);
    } catch (err) {
      setError(`Falha ao atualizar: ${(err as Error).message}`);
      setTxs((prev) =>
        prev.map((x) => (x.id === t.id ? { ...x, reconciled: t.reconciled } : x)),
      );
    } finally {
      setPendingId(null);
    }
  }

  if (loading) {
    return (
      <div className="panel">
        <p className="muted">Carregando…</p>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="panel">
        <p className="muted">Crie uma conta primeiro em “Contas financeiras”.</p>
      </div>
    );
  }

  return (
    <>
      {error && <p className="badge err">{error}</p>}

      <p className="muted">
        Marque os lançamentos que já apareceram no extrato do banco. O saldo
        conciliado deve bater com o saldo do seu banco; a diferença é o que ainda
        não compensou.
      </p>

      <div className="panel">
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            <span className="muted">Conta</span>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="muted" style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            <input
              type="checkbox"
              checked={onlyPending}
              onChange={(e) => setOnlyPending(e.target.checked)}
            />
            Mostrar só pendentes
          </label>
        </div>
      </div>

      {summary && (
        <div className="stat-row">
          <Stat label="Saldo conciliado" value={brl(summary.clearedBalance)} />
          <Stat label="Saldo atual (sistema)" value={brl(summary.currentBalance)} />
          <Stat
            label="A compensar"
            value={brl(summary.pendingAmount)}
            color={summary.pendingAmount === 0 ? "var(--ok)" : "var(--warn)"}
          />
          <Stat label="Pendentes" value={String(summary.pendingCount)} />
        </div>
      )}

      <div className="panel">
        {visible.length === 0 ? (
          <p className="muted">
            {accountTxs.length === 0
              ? "Nenhum lançamento nesta conta ainda."
              : "Tudo conciliado nesta conta. 🎉"}
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 40 }}>✓</th>
                  <th>Data</th>
                  <th>Descrição</th>
                  <th style={{ textAlign: "right" }}>Valor</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => {
                  const m = movementFor(t, accountId);
                  return (
                    <tr key={t.id} style={t.reconciled ? { opacity: 0.6 } : undefined}>
                      <td>
                        <input
                          type="checkbox"
                          checked={!!t.reconciled}
                          disabled={pendingId === t.id}
                          onChange={() => toggle(t)}
                        />
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>{brDate(t.date)}</td>
                      <td>{t.description || "—"}</td>
                      <td
                        style={{
                          textAlign: "right",
                          whiteSpace: "nowrap",
                          color: m >= 0 ? "var(--ok)" : "var(--err)",
                        }}
                      >
                        {m >= 0 ? "+" : "-"}
                        {brl(Math.abs(m))}
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
