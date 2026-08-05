"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LoginGate } from "@/components/LoginGate";
import { useAuth } from "@/services/auth-context";
import { listAccounts, listTransactions, updateAccount } from "@/services/firestore";
import { removeTransaction } from "@/services/transactions";
import {
  fetchCoraStatement,
  commitCoraEntries,
  getCoraSyncConfig,
  setCoraSyncConfig,
} from "@/services/cora";
import { compareWithCora, signedForAccount } from "@/lib/cora/reconcile";
import { DateParts } from "@/components/DateParts";
import type { Account, CoraSyncConfig, Transaction } from "@/types";
import type { NormalizedEntry } from "@/lib/cora/statement";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const brDate = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "—");
const isoDaysAgo = (days: number) =>
  new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

export default function CoraPage() {
  return (
    <>
      <h1>Sincronizar com o Cora</h1>
      <LoginGate>
        <CoraSync />
      </LoginGate>
    </>
  );
}

function CoraSync() {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [start, setStart] = useState(isoDaysAgo(30));
  const [end, setEnd] = useState(isoDaysAgo(0));
  const [entries, setEntries] = useState<NormalizedEntry[] | null>(null);
  const [endBalance, setEndBalance] = useState<number | null>(null);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [syncCfg, setSyncCfg] = useState<CoraSyncConfig | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    // Load accounts first and never let the sync-config read (which fails when
    // the doc doesn't exist yet / rules are older) break the account selector.
    try {
      const a = await listAccounts(user.uid);
      setAccounts(a);
      setAccountId((cur) => cur || a[0]?.id || "");
    } catch (err) {
      setError(`Falha ao carregar contas: ${(err as Error).message}`);
    }
    try {
      const cfg = await getCoraSyncConfig(user.uid);
      setSyncCfg(cfg);
      if (cfg?.accountId) setAccountId((cur) => cur || cfg.accountId);
    } catch {
      // Sem config ainda (ou regras antigas) — o painel fica desativado.
      setSyncCfg(null);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  async function search() {
    if (!user) return;
    setBusy(true);
    setError("");
    setResult("");
    setEntries(null);
    setEndBalance(null);
    try {
      const idToken = await user.getIdToken();
      const [found, allTxs] = await Promise.all([
        fetchCoraStatement(idToken, start, end),
        listTransactions(user.uid),
      ]);
      setEntries(found.entries);
      setEndBalance(found.endBalance);
      setTxs(allTxs);
      if (found.entries.length === 0) setResult("Nenhuma movimentação no período.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function importAll() {
    if (!user || !entries) return;
    if (!accountId) {
      setError("Selecione a conta onde os lançamentos serão criados.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await commitCoraEntries(user.uid, accountId, entries);
      setResult(
        `Importados ${r.created} lançamento(s).` +
          (r.skipped > 0 ? ` ${r.skipped} já existiam (ignorados).` : ""),
      );
      // Refresh the wallet side so the conferência below updates.
      setTxs(await listTransactions(user.uid));
    } catch (err) {
      setError(`Falha ao importar: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  // ── Conferência Cora × Wallet ────────────────────────────────────────────
  const comparison = useMemo(
    () => (entries && accountId ? compareWithCora(entries, txs, accountId, start, end) : null),
    [entries, txs, accountId, start, end],
  );

  const account = accounts.find((a) => a.id === accountId);

  /** Wallet balance of the account up to the end of the queried period. */
  const walletAtEnd = useMemo(() => {
    if (!account) return null;
    let bal = account.initialBalance ?? 0;
    for (const t of txs) {
      if (t.date <= end) bal += signedForAccount(t, accountId);
    }
    return Math.round(bal * 100) / 100;
  }, [account, txs, accountId, end]);

  const balanceDiff =
    endBalance != null && walletAtEnd != null
      ? Math.round((endBalance - walletAtEnd) * 100) / 100
      : null;

  async function deleteDuplicates() {
    if (!user || !comparison || comparison.duplicates.length === 0) return;
    setBusy(true);
    setError("");
    try {
      for (const d of comparison.duplicates) {
        if (d.id) await removeTransaction(user.uid, d.id);
      }
      setResult(`${comparison.duplicates.length} duplicata(s) excluída(s).`);
      setTxs(await listTransactions(user.uid));
    } catch (err) {
      setError(`Falha ao excluir duplicatas: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function adjustInitialBalance() {
    if (!user || !account?.id || balanceDiff == null || balanceDiff === 0) return;
    setBusy(true);
    setError("");
    try {
      const newInitial = Math.round(((account.initialBalance ?? 0) + balanceDiff) * 100) / 100;
      await updateAccount(account.id, { initialBalance: newInitial });
      const a = await listAccounts(user.uid);
      setAccounts(a);
      setResult(
        `Saldo inicial de "${account.name}" ajustado em ${brl(balanceDiff)} (novo: ${brl(newInitial)}).`,
      );
    } catch (err) {
      setError(`Falha ao ajustar o saldo: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function toggleAutoSync(enabled: boolean) {
    if (!user) return;
    if (enabled && !accountId) {
      setError("Selecione a conta de destino antes de ativar a sincronização automática.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await setCoraSyncConfig(user.uid, { enabled, accountId });
      setSyncCfg(await getCoraSyncConfig(user.uid));
      setResult(
        enabled
          ? "Sincronização automática ativada. A Wallet vai buscar as novas movimentações do Cora periodicamente."
          : "Sincronização automática desativada.",
      );
    } catch (err) {
      setError(`Falha ao salvar: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const totalIn = (entries ?? [])
    .filter((e) => e.type === "income")
    .reduce((s, e) => s + e.amount, 0);
  const totalOut = (entries ?? [])
    .filter((e) => e.type === "expense")
    .reduce((s, e) => s + e.amount, 0);

  return (
    <>
      {error && <p className="badge err">{error}</p>}
      {result && <p className="badge ok">{result}</p>}

      <div className="panel">
        <p className="muted" style={{ marginTop: 0 }}>
          Busca as movimentações da sua conta Cora no período e cria os
          lançamentos. Rodar de novo no mesmo período não duplica — cada
          movimentação é importada uma única vez.
        </p>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
            <span className="muted" style={{ fontSize: "0.75rem" }}>Conta (destino)</span>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">— selecione —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
            <span className="muted" style={{ fontSize: "0.75rem" }}>De</span>
            <DateParts value={start} onChange={setStart} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
            <span className="muted" style={{ fontSize: "0.75rem" }}>Até</span>
            <DateParts value={end} onChange={setEnd} />
          </label>
          <button disabled={busy} onClick={search}>
            {busy ? "Buscando…" : "Buscar no Cora"}
          </button>
        </div>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Sincronização automática</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Quando ativada, a Wallet busca sozinha as novas movimentações do Cora
          de tempos em tempos e cria os lançamentos na conta escolhida acima —
          sem você precisar abrir esta tela.
        </p>
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input
            type="checkbox"
            checked={!!syncCfg?.enabled}
            disabled={busy}
            onChange={(e) => toggleAutoSync(e.target.checked)}
          />
          <span>
            <strong>Ativar sincronização automática</strong>
            {syncCfg?.accountId && accounts.length > 0 && (
              <span className="muted">
                {" "}— conta:{" "}
                {accounts.find((a) => a.id === syncCfg.accountId)?.name ?? "—"}
              </span>
            )}
          </span>
        </label>
        {syncCfg?.lastRunAt && (
          <p className="muted" style={{ fontSize: "0.82rem", marginBottom: 0 }}>
            Última execução: {new Date(syncCfg.lastRunAt).toLocaleString("pt-BR")}
            {syncCfg.lastResult ? ` — ${syncCfg.lastResult}` : ""}
          </p>
        )}
      </div>

      {entries && entries.length > 0 && (
        <div className="panel">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "0.75rem",
              marginBottom: "0.75rem",
            }}
          >
            <span className="muted">
              {entries.length} movimentação(ões) · entradas {brl(totalIn)} · saídas {brl(totalOut)}
            </span>
            <button disabled={busy} onClick={importAll}>
              {busy ? "Importando…" : `Importar ${entries.length} lançamento(s)`}
            </button>
          </div>
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
                {entries.map((e) => (
                  <tr key={e.externalId}>
                    <td style={{ whiteSpace: "nowrap" }}>{brDate(e.date)}</td>
                    <td>{e.description}</td>
                    <td>{e.type === "income" ? "Receita" : "Despesa"}</td>
                    <td
                      style={{
                        textAlign: "right",
                        whiteSpace: "nowrap",
                        color: e.type === "income" ? "var(--ok)" : "var(--err)",
                      }}
                    >
                      {e.type === "income" ? "+" : "-"}
                      {brl(e.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {comparison && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Conferência Cora × Wallet</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Comparação do período {brDate(start)} a {brDate(end)} na conta{" "}
            <strong>{account?.name ?? "—"}</strong>.
          </p>

          <div className="stat-row">
            <Stat label="Movimento no Cora" value={brl(comparison.coraNet)} />
            <Stat label="Movimento na Wallet" value={brl(comparison.walletNet)} />
            <Stat
              label="Diferença do período"
              value={brl(Math.round((comparison.walletNet - comparison.coraNet) * 100) / 100)}
              color={
                Math.abs(comparison.walletNet - comparison.coraNet) < 0.005
                  ? "var(--ok)"
                  : "var(--err)"
              }
            />
          </div>

          {endBalance != null && walletAtEnd != null && (
            <div style={{ marginTop: "0.75rem" }}>
              <div className="stat-row">
                <Stat label={`Saldo real no Cora (${brDate(end)})`} value={brl(endBalance)} />
                <Stat label="Saldo da conta na Wallet" value={brl(walletAtEnd)} />
                <Stat
                  label="Diferença de saldo"
                  value={brl(balanceDiff ?? 0)}
                  color={balanceDiff === 0 ? "var(--ok)" : "var(--err)"}
                />
              </div>
              {balanceDiff !== 0 && balanceDiff != null && (
                <p style={{ marginBottom: 0 }}>
                  <button disabled={busy} onClick={adjustInitialBalance}>
                    Ajustar saldo inicial para bater com o Cora ({brl(balanceDiff)})
                  </button>{" "}
                  <span className="muted" style={{ fontSize: "0.82rem" }}>
                    Dica: exclua as duplicatas abaixo primeiro, depois ajuste o saldo.
                  </span>
                </p>
              )}
            </div>
          )}

          {comparison.duplicates.length > 0 && (
            <div style={{ marginTop: "1rem" }}>
              <h3 style={{ marginBottom: "0.4rem" }}>
                Prováveis duplicatas na Wallet ({comparison.duplicates.length})
              </h3>
              <p className="muted" style={{ marginTop: 0, fontSize: "0.85rem" }}>
                Mesmo dia, valor e sentido de uma movimentação do Cora, mas registradas
                por outra origem (importação antiga ou baixa). O banco só mostra uma —
                estas são o excedente.
              </p>
              <button
                style={{ background: "var(--err)", marginBottom: "0.6rem" }}
                disabled={busy}
                onClick={deleteDuplicates}
              >
                {busy ? "Excluindo…" : `Excluir ${comparison.duplicates.length} duplicata(s)`}
              </button>
              <MiniList
                rows={comparison.duplicates.map((d) => ({
                  key: d.id ?? d.dedupHash,
                  date: d.date,
                  label: d.description || "(sem descrição)",
                  amount: signedForAccount(d, accountId),
                }))}
              />
            </div>
          )}

          {comparison.walletOnly.length > 0 && (
            <div style={{ marginTop: "1rem" }}>
              <h3 style={{ marginBottom: "0.4rem" }}>
                Só na Wallet ({comparison.walletOnly.length})
              </h3>
              <p className="muted" style={{ marginTop: 0, fontSize: "0.85rem" }}>
                Lançamentos desta conta que não aparecem no extrato do Cora neste
                período — confira se são desta conta mesmo ou se a data/valor difere.
              </p>
              <MiniList
                rows={comparison.walletOnly.map((d) => ({
                  key: d.id ?? d.dedupHash,
                  date: d.date,
                  label: d.description || "(sem descrição)",
                  amount: signedForAccount(d, accountId),
                }))}
              />
            </div>
          )}

          {comparison.coraOnly.length > 0 && (
            <div style={{ marginTop: "1rem" }}>
              <h3 style={{ marginBottom: "0.4rem" }}>
                Só no Cora ({comparison.coraOnly.length})
              </h3>
              <p className="muted" style={{ marginTop: 0, fontSize: "0.85rem" }}>
                Movimentações do banco ainda sem lançamento na Wallet — use
                “Importar” acima para criá-las.
              </p>
              <MiniList
                rows={comparison.coraOnly.map((e) => ({
                  key: e.externalId,
                  date: e.date,
                  label: e.description,
                  amount: e.type === "income" ? e.amount : -e.amount,
                }))}
              />
            </div>
          )}

          {comparison.duplicates.length === 0 &&
            comparison.walletOnly.length === 0 &&
            comparison.coraOnly.length === 0 && (
              <p className="badge ok" style={{ marginBottom: 0 }}>
                Nenhuma divergência de movimentações no período. 🎉
              </p>
            )}
        </div>
      )}
    </>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="stat">
      <div className="n" style={{ fontSize: "1.1rem", ...(color ? { color } : {}) }}>
        {value}
      </div>
      <div className="muted">{label}</div>
    </div>
  );
}

function MiniList({
  rows,
}: {
  rows: Array<{ key: string; date: string; label: string; amount: number }>;
}) {
  const MAX = 60;
  const shown = rows.slice(0, MAX);
  return (
    <div style={{ overflowX: "auto" }}>
      <table>
        <tbody>
          {shown.map((r) => (
            <tr key={r.key}>
              <td style={{ whiteSpace: "nowrap", width: 110 }}>{brDate(r.date)}</td>
              <td>{r.label}</td>
              <td
                style={{
                  textAlign: "right",
                  whiteSpace: "nowrap",
                  color: r.amount >= 0 ? "var(--ok)" : "var(--err)",
                }}
              >
                {r.amount >= 0 ? "+" : "-"}
                {brl(Math.abs(r.amount))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > MAX && (
        <p className="muted" style={{ fontSize: "0.8rem" }}>… e mais {rows.length - MAX}.</p>
      )}
    </div>
  );
}
