"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { loadErrorMessage } from "@/lib/errors";
import { LoginGate } from "@/components/LoginGate";
import { useAuth } from "@/services/auth-context";
import { onListsChange } from "@/services/live-store";
import { listAccounts, listTransactions } from "@/services/firestore";
import { listBills, backfillPaymentTransactions } from "@/services/bills";
import { createTransaction, setReconciled } from "@/services/transactions";
import { parseBrCurrency } from "@/lib/br/parse";
import { todayBr } from "@/lib/br/date";
import {
  movementFor,
  transactionsForAccount,
  summarizeClearing,
} from "@/lib/reconcile/clearing";
import { computeCashBalances } from "@/lib/dashboard/cash";
import { useColumnFilters, FilterRow, type ColFilterDef } from "@/components/ColumnFilter";
import type { Account, Bill, Transaction } from "@/types";

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
  const [payables, setPayables] = useState<Bill[]>([]);
  const [receivables, setReceivables] = useState<Bill[]>([]);
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
      const [a, t, pay, rec] = await Promise.all([
        listAccounts(user.uid),
        listTransactions(user.uid),
        listBills(user.uid, "payable"),
        listBills(user.uid, "receivable"),
      ]);
      // Ordem preferida dos botões de conta: Cora, C6, BTG, demais.
      const rank = (n: string) => {
        const s = n.toLowerCase();
        if (s.includes("cora")) return 0;
        if (s.includes("c6")) return 1;
        if (s.includes("btg")) return 2;
        return 3;
      };
      const sorted = [...a].sort(
        (x, y) => rank(x.name) - rank(y.name) || x.name.localeCompare(y.name, "pt-BR"),
      );
      setAccounts(sorted);
      setTxs(t);
      setPayables(pay);
      setReceivables(rec);
      setAccountId((cur) => cur || sorted[0]?.id || "");
    } catch (err) {
      setError(`Falha ao carregar: ${loadErrorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  // Recarrega sozinho quando os dados mudam em outro aparelho/tela.
  useEffect(() => onListsChange(() => { void load(); }), [load]);

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

  // Saldo desta conta pelo MESMO cálculo do Dashboard ("Saldos de caixa"),
  // para comparação lado a lado — qualquer diferença fica exposta na tela.
  const dashConfirmed = useMemo(() => {
    const row = computeCashBalances(accounts, txs, payables, receivables).rows.find(
      (r) => r.accountId === accountId,
    );
    return row ? row.confirmed : null;
  }, [accounts, txs, payables, receivables, accountId]);

  const bills = useMemo(() => [...payables, ...receivables], [payables, receivables]);

  // Baixas antigas desta conta que ainda não viraram lançamento: o Dashboard
  // as soma, mas esta tela (que trabalha sobre lançamentos) não as vê — o que
  // faria o saldo daqui divergir. Detecta e oferece a correção na hora.
  const unmaterialized = useMemo(() => {
    let net = 0;
    let count = 0;
    const affected: Bill[] = [];
    for (const b of bills) {
      let touches = false;
      for (const p of b.payments ?? []) {
        if (p.transactionId) continue;
        if ((p.accountId ?? b.accountId) !== accountId) continue;
        net += b.kind === "receivable" ? p.amount || 0 : -(p.amount || 0);
        count++;
        touches = true;
      }
      if (touches) affected.push(b);
    }
    return { net: Math.round(net * 100) / 100, count, affected };
  }, [bills, accountId]);

  const [fixingBaixas, setFixingBaixas] = useState(false);
  async function materializeBaixas() {
    setFixingBaixas(true);
    setError("");
    try {
      const created = await backfillPaymentTransactions(unmaterialized.affected);
      await load();
      setError(`✅ ${created} baixa(s) transformada(s) em lançamento.`);
    } catch (err) {
      setError(`Falha ao corrigir baixas: ${(err as Error).message}`);
    } finally {
      setFixingBaixas(false);
    }
  }

  const origem = (t: Transaction) =>
    t.externalId?.startsWith("cora:") ? "Banco (Cora)" : "App/Importação";

  const filterDefs: ColFilterDef<Transaction>[] = [
    { key: "check", type: "none" },
    { key: "date", value: (t) => brDate(t.date) },
    { key: "description", value: (t) => t.description || "" },
    { key: "origem", type: "select", value: origem },
    { key: "amount", value: (t) => brl(Math.abs(movementFor(t, accountId))), align: "right" },
  ];
  const cf = useColumnFilters(visible, filterDefs);

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

  const [bulkBusy, setBulkBusy] = useState(false);

  // ── Acerto definitivo: digite o saldo real do banco e o app ajusta o saldo
  // inicial da conta na diferença exata e marca tudo como conciliado. A partir
  // daí Conciliação, Dashboard e Saldos de caixa mostram o mesmo número.
  const [bankBalance, setBankBalance] = useState("");
  const [settling, setSettling] = useState(false);

  async function forceMatchBank() {
    if (!user || !account?.id || !summary) return;
    const target = parseBrCurrency(bankBalance);
    if (target == null) {
      setError("Informe o saldo real do banco (ex.: 2.020,94).");
      return;
    }
    const delta = Math.round((target - summary.currentBalance) * 100) / 100;
    setSettling(true);
    setError("");
    try {
      // O acerto vira um LANÇAMENTO visível ("Ajuste de saldo"), não uma
      // mudança escondida no saldo inicial — dá para ver, rastrear e excluir.
      if (delta !== 0) {
        const id = await createTransaction(user.uid, {
          date: todayBr(),
          amount: Math.abs(delta),
          type: delta > 0 ? "income" : "expense",
          description: "Ajuste de saldo — acerto com o banco (conciliação)",
          accountId: account.id,
          notes: `Sistema mostrava ${brl(summary.currentBalance)}; banco informou ${brl(target)}.`,
        });
        await setReconciled(id, true);
      }
      // Marca tudo desta conta como conciliado — ponto de partida limpo.
      const targets = accountTxs.filter((t) => t.id && !t.reconciled);
      for (const t of targets) await setReconciled(t.id!, true);
      await load();
      setBankBalance("");
      setError(
        delta === 0
          ? `✅ Nada a ajustar: o sistema já estava em ${brl(target)}. ${targets.length} lançamento(s) marcado(s) como conciliado(s).`
          : `✅ Acertado: criado o lançamento "Ajuste de saldo" de ${brl(delta)} e ${targets.length} lançamento(s) conciliado(s). Saldo da conta agora: ${brl(target)}.`,
      );
    } catch (err) {
      setError(`Falha no acerto: ${(err as Error).message}`);
    } finally {
      setSettling(false);
    }
  }

  /** Mark/unmark every currently visible (filtered) row of this account. */
  async function bulkSet(reconciled: boolean) {
    const targets = cf.filtered.filter((t) => t.id && !!t.reconciled !== reconciled);
    if (targets.length === 0) return;
    setBulkBusy(true);
    setError("");
    try {
      for (const t of targets) {
        await setReconciled(t.id!, reconciled);
      }
      const ids = new Set(targets.map((t) => t.id));
      setTxs((prev) => prev.map((x) => (ids.has(x.id) ? { ...x, reconciled } : x)));
    } catch (err) {
      setError(`Falha ao atualizar em massa: ${(err as Error).message}`);
      await load();
    } finally {
      setBulkBusy(false);
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
          <span className="muted">Conta</span>
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
            {accounts.map((a) => {
              const active = accountId === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setAccountId(a.id!)}
                  style={{
                    padding: "0.45rem 0.9rem",
                    borderRadius: 8,
                    border: active ? "2px solid var(--accent)" : "1px solid var(--border)",
                    background: active ? "var(--accent)" : "var(--panel)",
                    color: active ? "var(--accent-ink)" : "var(--text)",
                    font: "inherit",
                    fontWeight: active ? 700 : 400,
                    cursor: "pointer",
                  }}
                >
                  {a.name}
                </button>
              );
            })}
          </div>
          <label className="muted" style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            <input
              type="checkbox"
              checked={onlyPending}
              onChange={(e) => setOnlyPending(e.target.checked)}
            />
            Mostrar só pendentes
          </label>
          <button
            style={{ background: "var(--border)" }}
            disabled={bulkBusy || cf.filtered.length === 0}
            onClick={() => bulkSet(false)}
            title="Remove o ✓ de todos os lançamentos visíveis, para conciliar manualmente do zero."
          >
            {bulkBusy ? "Atualizando…" : "Desmarcar todos"}
          </button>
          <button
            style={{ background: "var(--border)" }}
            disabled={bulkBusy || cf.filtered.length === 0}
            onClick={() => bulkSet(true)}
            title="Marca todos os lançamentos visíveis como conciliados."
          >
            {bulkBusy ? "Atualizando…" : "Marcar todos"}
          </button>
        </div>
        <p className="muted" style={{ marginBottom: 0, fontSize: "0.82rem" }}>
          Os botões agem sobre a lista visível (respeitam os filtros). Dica: se a
          sincronização antiga marcou tudo como conciliado, use “Desmarcar todos”
          para recomeçar e ir dando baixa item por item.
        </p>
      </div>

      {unmaterialized.count > 0 && (
        <div className="panel" style={{ borderColor: "var(--warn)" }}>
          <p style={{ marginTop: 0 }}>
            ⚠ Esta conta tem <strong>{unmaterialized.count} baixa(s) antiga(s)</strong> de
            contas a pagar/receber que ainda não viraram lançamento (efeito de{" "}
            <strong>{brl(unmaterialized.net)}</strong> no saldo). Por isso o saldo desta tela
            pode diferir do Dashboard.
          </p>
          <button disabled={fixingBaixas} onClick={materializeBaixas}>
            {fixingBaixas ? "Corrigindo…" : "Corrigir agora (criar os lançamentos)"}
          </button>
        </div>
      )}

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

      {summary && account && (
        <p className="muted" style={{ fontSize: "0.82rem", marginTop: "-0.25rem" }}>
          Cálculo do saldo atual: saldo inicial da conta ({brl(account.initialBalance ?? 0)}) +
          todos os lançamentos ({brl(summary.currentBalance - (account.initialBalance ?? 0))}) ={" "}
          {brl(summary.currentBalance)} — o mesmo cálculo do Dashboard.
        </p>
      )}

      {summary && account && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Acertar com o banco (recomeço limpo)</h2>
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            Digite o saldo que aparece <strong>agora</strong> no app do banco. O sistema cria um
            lançamento visível de <strong>"Ajuste de saldo"</strong> com a diferença exata (fica
            fixado na conta — dá para ver em Lançamentos e excluir para desfazer) e marca tudo
            como conciliado. Conciliação, Dashboard e Saldos de caixa passam a mostrar esse mesmo
            valor.
          </p>
          <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
            <input
              placeholder="Ex.: 2.020,94"
              value={bankBalance}
              onChange={(e) => setBankBalance(e.target.value)}
              inputMode="decimal"
              style={{
                padding: "0.45rem 0.6rem",
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--text)",
                font: "inherit",
                width: 150,
                textAlign: "right",
              }}
            />
            <button disabled={settling || !bankBalance.trim()} onClick={forceMatchBank}>
              {settling ? "Acertando…" : `Acertar ${account.name} agora`}
            </button>
          </div>
        </div>
      )}

      {summary &&
        dashConfirmed != null &&
        Math.round((dashConfirmed - summary.currentBalance) * 100) !== 0 && (
          <div className="panel" style={{ borderColor: "var(--err)" }}>
            <p style={{ margin: 0 }}>
              ⚠ O Dashboard mostra <strong>{brl(dashConfirmed)}</strong> para esta conta —
              diferença de{" "}
              <strong>{brl(Math.round((dashConfirmed - summary.currentBalance) * 100) / 100)}</strong>{" "}
              em relação a esta tela.
              {unmaterialized.count > 0
                ? " A causa são as baixas antigas indicadas acima — use “Corrigir agora”."
                : " Tire um print desta tela e me envie para eu investigar."}
            </p>
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
                  <th>Origem</th>
                  <th style={{ textAlign: "right" }}>Valor</th>
                </tr>
                <FilterRow defs={filterDefs} cf={cf} />
              </thead>
              <tbody>
                {cf.filtered.map((t) => {
                  const m = movementFor(t, accountId);
                  const doBanco = t.externalId?.startsWith("cora:");
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
                      <td style={{ whiteSpace: "nowrap" }}>
                        <span
                          className="badge"
                          style={
                            doBanco
                              ? { background: "rgba(46,204,113,0.15)", color: "var(--ok)" }
                              : { background: "var(--border)", color: "var(--muted)" }
                          }
                        >
                          {doBanco ? "Banco (Cora)" : "App/Importação"}
                        </span>
                      </td>
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
