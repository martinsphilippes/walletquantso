"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LoginGate } from "@/components/LoginGate";
import { useAuth } from "@/services/auth-context";
import {
  createAccount,
  deleteAccount,
  listAccounts,
  listTransactions,
  updateAccount,
} from "@/services/firestore";
import { listBills } from "@/services/bills";
import { computeBalances } from "@/lib/dashboard/balances";
import type { Account, AccountType, Bill, Transaction } from "@/types";

const TYPE_LABELS: Record<AccountType, string> = {
  checking: "Conta corrente",
  savings: "Poupança",
  credit_card: "Cartão de crédito",
  cash: "Dinheiro",
  investment: "Investimento",
  other: "Outro",
};
const TYPES = Object.keys(TYPE_LABELS) as AccountType[];

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function AccountsPage() {
  return (
    <>
      <h1>Contas e saldos</h1>
      <LoginGate>
        <Accounts />
      </LoginGate>
    </>
  );
}

interface Draft {
  name: string;
  type: AccountType;
  initialBalance: string;
}

function Accounts() {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ name: "", type: "other", initialBalance: "0" });
  const [creating, setCreating] = useState<Draft>({
    name: "",
    type: "checking",
    initialBalance: "0",
  });
  const [busy, setBusy] = useState(false);

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
      setAccounts(a);
      setTxs(t);
      setBills([...pay, ...rec]);
    } catch (err) {
      setError(`Falha ao carregar: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const result = useMemo(() => computeBalances(accounts, txs), [accounts, txs]);
  const balanceById = useMemo(
    () => new Map(result.balances.map((b) => [b.accountId, b])),
    [result],
  );

  // How many records still point at each account (blocks deletion when in use).
  const usageById = useMemo(() => {
    const usage = new Map<string, number>();
    const bump = (id?: string | null) => {
      if (!id) return;
      usage.set(id, (usage.get(id) ?? 0) + 1);
    };
    for (const t of txs) {
      bump(t.accountId);
      bump(t.transferAccountId);
    }
    for (const b of bills) {
      bump(b.accountId);
      for (const p of b.payments ?? []) bump(p.accountId);
    }
    return usage;
  }, [txs, bills]);

  async function handleDelete(a: Account) {
    if (!a.id) return;
    const uses = usageById.get(a.id) ?? 0;
    if (uses > 0) {
      setError(
        `Não é possível excluir “${a.name}”: a conta está em uso em ${uses} lançamento(s)/título(s). ` +
          `Reatribua ou remova esses registros antes de excluir a conta.`,
      );
      return;
    }
    if (!confirm(`Excluir a conta “${a.name}”? Esta ação não pode ser desfeita.`)) return;
    setBusy(true);
    setError("");
    try {
      await deleteAccount(a.id);
      if (editingId === a.id) setEditingId(null);
      await load();
    } catch (err) {
      setError(`Falha ao excluir: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  function startEdit(a: Account) {
    setEditingId(a.id!);
    setDraft({
      name: a.name,
      type: a.type,
      initialBalance: String(a.initialBalance ?? 0),
    });
  }

  async function saveEdit(id: string) {
    setBusy(true);
    setError("");
    try {
      await updateAccount(id, {
        name: draft.name.trim(),
        type: draft.type,
        initialBalance: parseFloat(draft.initialBalance.replace(",", ".")) || 0,
      });
      setEditingId(null);
      await load();
    } catch (err) {
      setError(`Falha ao salvar: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function createNew(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !creating.name.trim()) return;
    setBusy(true);
    setError("");
    try {
      await createAccount({
        ownerId: user.uid,
        name: creating.name.trim(),
        type: creating.type,
        initialBalance: parseFloat(creating.initialBalance.replace(",", ".")) || 0,
        currency: "BRL",
        archived: false,
        createdAt: Date.now(),
      });
      setCreating({ name: "", type: "checking", initialBalance: "0" });
      await load();
    } catch (err) {
      setError(`Falha ao criar: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

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

      <div className="stat-row">
        <div className="stat">
          <div className="n" style={{ fontSize: "1.2rem" }}>
            {brl(result.total)}
          </div>
          <div className="muted">Saldo total</div>
        </div>
        <div className="stat">
          <div className="n" style={{ fontSize: "1.2rem" }}>
            {accounts.length}
          </div>
          <div className="muted">Contas</div>
        </div>
      </div>

      {result.unassignedMovements !== 0 && (
        <p className="badge warn">
          {brl(result.unassignedMovements)} em movimentações estão ligadas a contas
          que não existem mais — verifique os lançamentos.
        </p>
      )}

      <div className="panel">
        {accounts.length === 0 ? (
          <p className="muted">Nenhuma conta ainda. Crie a primeira abaixo.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Conta</th>
                <th>Tipo</th>
                <th style={{ textAlign: "right" }}>Saldo inicial</th>
                <th style={{ textAlign: "right" }}>Movimentações</th>
                <th style={{ textAlign: "right" }}>Saldo atual</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const bal = balanceById.get(a.id!);
                const editing = editingId === a.id;
                return (
                  <tr key={a.id}>
                    {editing ? (
                      <>
                        <td>
                          <input
                            value={draft.name}
                            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                            style={fieldStyle}
                          />
                        </td>
                        <td>
                          <select
                            value={draft.type}
                            onChange={(e) =>
                              setDraft({ ...draft, type: e.target.value as AccountType })
                            }
                          >
                            {TYPES.map((t) => (
                              <option key={t} value={t}>
                                {TYPE_LABELS[t]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <input
                            value={draft.initialBalance}
                            onChange={(e) =>
                              setDraft({ ...draft, initialBalance: e.target.value })
                            }
                            style={{ ...fieldStyle, width: 110, textAlign: "right" }}
                          />
                        </td>
                        <td style={{ textAlign: "right" }} className="muted">
                          {bal ? brl(bal.movements) : "—"}
                        </td>
                        <td style={{ textAlign: "right" }} className="muted">
                          —
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <button disabled={busy} onClick={() => saveEdit(a.id!)}>
                            Salvar
                          </button>{" "}
                          <button
                            style={{ background: "var(--border)" }}
                            onClick={() => setEditingId(null)}
                          >
                            Cancelar
                          </button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td>{a.name}</td>
                        <td>{TYPE_LABELS[a.type]}</td>
                        <td style={{ textAlign: "right" }}>{brl(a.initialBalance ?? 0)}</td>
                        <td style={{ textAlign: "right" }}>{bal ? brl(bal.movements) : "—"}</td>
                        <td
                          style={{
                            textAlign: "right",
                            fontWeight: 700,
                            color:
                              bal && bal.current < 0 ? "var(--err)" : "var(--ok)",
                          }}
                        >
                          {bal ? brl(bal.current) : "—"}
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <button
                            style={{ background: "var(--border)" }}
                            onClick={() => startEdit(a)}
                          >
                            Editar
                          </button>{" "}
                          <button
                            style={{ background: "var(--err)" }}
                            disabled={busy}
                            title={
                              (usageById.get(a.id!) ?? 0) > 0
                                ? "Conta em uso — reatribua os lançamentos/títulos antes de excluir"
                                : "Excluir conta"
                            }
                            onClick={() => handleDelete(a)}
                          >
                            Excluir
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h2>Nova conta</h2>
        <form onSubmit={createNew} style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <input
            placeholder="Nome da conta"
            value={creating.name}
            onChange={(e) => setCreating({ ...creating, name: e.target.value })}
            required
            style={fieldStyle}
          />
          <select
            value={creating.type}
            onChange={(e) => setCreating({ ...creating, type: e.target.value as AccountType })}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <input
            placeholder="Saldo inicial"
            value={creating.initialBalance}
            onChange={(e) => setCreating({ ...creating, initialBalance: e.target.value })}
            style={{ ...fieldStyle, width: 130, textAlign: "right" }}
          />
          <button type="submit" disabled={busy}>
            Adicionar
          </button>
        </form>
        <p className="muted" style={{ marginTop: "0.5rem" }}>
          O saldo inicial é o ponto de partida da conta (ex.: o saldo que ela tinha
          quando você começou a registrar no Meu Dinheiro). O saldo atual é
          calculado somando as movimentações importadas.
        </p>
      </div>
    </>
  );
}

const fieldStyle: React.CSSProperties = {
  padding: "0.35rem 0.5rem",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
  font: "inherit",
};
