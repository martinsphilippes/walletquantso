"use client";

import { useCallback, useEffect, useState } from "react";
import { LoginGate } from "@/components/LoginGate";
import { useAuth } from "@/services/auth-context";
import { listAccounts } from "@/services/firestore";
import {
  fetchCoraStatement,
  commitCoraEntries,
  getCoraSyncConfig,
  setCoraSyncConfig,
} from "@/services/cora";
import { DateParts } from "@/components/DateParts";
import type { Account, CoraSyncConfig } from "@/types";
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [syncCfg, setSyncCfg] = useState<CoraSyncConfig | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const [a, cfg] = await Promise.all([
      listAccounts(user.uid),
      getCoraSyncConfig(user.uid),
    ]);
    setAccounts(a);
    setSyncCfg(cfg);
    setAccountId((cur) => cur || cfg?.accountId || a[0]?.id || "");
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
    try {
      const idToken = await user.getIdToken();
      const found = await fetchCoraStatement(idToken, start, end);
      setEntries(found);
      if (found.length === 0) setResult("Nenhuma movimentação no período.");
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
      setEntries(null);
    } catch (err) {
      setError(`Falha ao importar: ${(err as Error).message}`);
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
    </>
  );
}
