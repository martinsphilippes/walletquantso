"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { loadErrorMessage } from "@/lib/errors";
import { LoginGate } from "@/components/LoginGate";
import { useAuth } from "@/services/auth-context";
import {
  createAccount,
  deleteAccount,
  listAccounts,
  listCategories,
  listCostCenters,
  listTransactions,
  updateAccount,
} from "@/services/firestore";
import { createCategory } from "@/services/categories";
import { describeFee } from "@/lib/fees/fee";
import { maskBrAmount, parseBrCurrency } from "@/lib/br/parse";
import { listBills } from "@/services/bills";
import { computeBalances } from "@/lib/dashboard/balances";
import { useColumnFilters, FilterRow, type ColFilterDef } from "@/components/ColumnFilter";
import { useBulkSelect, SelectAllCheckbox, RowCheckbox, BulkBar } from "@/components/BulkSelect";
import type { Account, AccountFee, AccountType, Bill, Category, CostCenter, Transaction } from "@/types";

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
  const [categories, setCategories] = useState<Category[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ name: "", type: "other", initialBalance: "" });
  const [creating, setCreating] = useState<Draft>({
    name: "",
    type: "checking",
    initialBalance: "",
  });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setError("");
    setLoading(true);
    try {
      const [a, t, pay, rec, cats, ccs] = await Promise.all([
        listAccounts(user.uid),
        listTransactions(user.uid),
        listBills(user.uid, "payable"),
        listBills(user.uid, "receivable"),
        listCategories(user.uid),
        listCostCenters(user.uid),
      ]);
      setCategories(cats);
      setCostCenters([...ccs].sort((x, y) => x.name.localeCompare(y.name, "pt-BR")));
      setAccounts(a);
      setTxs(t);
      setBills([...pay, ...rec]);
    } catch (err) {
      setError(`Falha ao carregar: ${loadErrorMessage(err)}`);
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

  const filterDefs: ColFilterDef<Account>[] = [
    { key: "select", type: "none" },
    { key: "name", value: (a) => a.name },
    { key: "type", type: "select", value: (a) => TYPE_LABELS[a.type] },
    { key: "initial", value: (a) => brl(a.initialBalance ?? 0), align: "right" },
    { key: "movements", value: (a) => (balanceById.get(a.id!) ? brl(balanceById.get(a.id!)!.movements) : ""), align: "right" },
    { key: "current", value: (a) => (balanceById.get(a.id!) ? brl(balanceById.get(a.id!)!.current) : ""), align: "right" },
    { key: "fee", type: "select", value: (a) => (a.fee ? describeFee(a.fee) : "") },
    { key: "actions", type: "none" },
  ];
  const cf = useColumnFilters(accounts, filterDefs);
  const sel = useBulkSelect(cf.filtered, (a) => a.id);

  async function bulkDelete() {
    if (sel.count === 0) return;
    setBusy(true);
    setError("");
    const byId = new Map(accounts.map((a) => [a.id!, a]));
    const blocked: string[] = [];
    try {
      for (const id of sel.selectedIds) {
        const a = byId.get(id);
        if (!a) continue;
        if ((usageById.get(id) ?? 0) > 0) {
          blocked.push(a.name);
          continue;
        }
        await deleteAccount(id);
        if (editingId === id) setEditingId(null);
      }
      sel.clear();
      await load();
      if (blocked.length > 0) {
        setError(
          `${blocked.length} conta(s) não foram excluídas por estarem em uso: ${blocked.join(", ")}. ` +
            `Reatribua ou remova os lançamentos/títulos ligados a elas primeiro.`,
        );
      }
    } catch (err) {
      setError(`Falha ao excluir: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

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
      initialBalance: (a.initialBalance ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    });
  }

  async function saveEdit(id: string) {
    setBusy(true);
    setError("");
    try {
      await updateAccount(id, {
        name: draft.name.trim(),
        type: draft.type,
        initialBalance: parseBrCurrency(draft.initialBalance) ?? 0,
      });
      setEditingId(null);
      await load();
    } catch (err) {
      setError(`Falha ao salvar: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  // ── Taxa da conta (ex.: Depix) ──────────────────────────────────────────
  interface FeeDraft {
    percent: string;
    fixed: string;
    onIncome: boolean;
    onExpense: boolean;
    onTransfer: boolean;
    costCenterId: string;
    categoryId: string;
  }
  const [feeId, setFeeId] = useState<string | null>(null);
  const [feeDraft, setFeeDraft] = useState<FeeDraft | null>(null);
  const [feeMsg, setFeeMsg] = useState("");
  const fmt2 = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const expenseMains = categories.filter((c) => !c.parentId && c.kind === "expense");

  function openFee(a: Account) {
    const f = a.fee;
    // Centro sugerido: o da categoria já escolhida, ou "Não Operacionais".
    const suggested = costCenters.find((c) => /n[aã]o\s*operaciona/i.test(c.name))?.id ?? "";
    const catCenter = f?.categoryId ? (categories.find((c) => c.id === f.categoryId)?.costCenterId ?? "") : "";
    setFeeId(a.id!);
    setFeeMsg("");
    setFeeDraft({
      percent: f ? String(f.percent ?? 0).replace(".", ",") : "",
      fixed: f && f.fixed ? fmt2(f.fixed) : "",
      onIncome: f ? f.onIncome : true,
      onExpense: f ? f.onExpense : true,
      onTransfer: f ? f.onTransfer : true,
      costCenterId: f?.costCenterId ?? (catCenter || suggested),
      categoryId: f?.categoryId ?? "",
    });
  }

  async function createFeeCategory(a: Account) {
    if (!user || !feeDraft) return;
    if (!feeDraft.costCenterId) {
      setFeeMsg("Escolha o centro de custo da taxa antes de criar a categoria.");
      return;
    }
    const name = `Taxa ${a.name}`;
    const existing = expenseMains.find(
      (c) => c.name.toLowerCase() === name.toLowerCase() && (c.costCenterId ?? "") === feeDraft.costCenterId,
    );
    if (existing) {
      setFeeDraft({ ...feeDraft, categoryId: existing.id! });
      return;
    }
    setBusy(true);
    try {
      const id = await createCategory({
        ownerId: user.uid,
        name,
        kind: "expense",
        parentId: null,
        costCenterId: feeDraft.costCenterId,
        createdAt: Date.now(),
      });
      setCategories([...categories, { id, ownerId: user.uid, name, kind: "expense", parentId: null, costCenterId: feeDraft.costCenterId, createdAt: Date.now() }]);
      setFeeDraft({ ...feeDraft, categoryId: id });
      setFeeMsg(`✅ Categoria "${name}" criada.`);
    } catch (err) {
      setFeeMsg(`❌ Falha ao criar a categoria: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveFee(a: Account, remove = false) {
    if (!feeDraft) return;
    let fee: AccountFee | null = null;
    if (!remove) {
      const percent = Number((feeDraft.percent || "0").replace(",", "."));
      const fixed = parseBrCurrency(feeDraft.fixed || "0") ?? 0;
      if (!Number.isFinite(percent) || percent < 0 || percent >= 100) {
        setFeeMsg("Percentual entre 0 e 100.");
        return;
      }
      if (percent <= 0 && fixed <= 0) {
        setFeeMsg("Informe o percentual e/ou a taxa fixa.");
        return;
      }
      if (!feeDraft.onIncome && !feeDraft.onExpense && !feeDraft.onTransfer) {
        setFeeMsg("Marque em quais operações a taxa vale.");
        return;
      }
      if (!feeDraft.categoryId) {
        setFeeMsg("Escolha a categoria da taxa (ou crie a categoria Taxa da conta).");
        return;
      }
      fee = {
        percent: Math.round(percent * 10000) / 10000,
        fixed,
        onIncome: feeDraft.onIncome,
        onExpense: feeDraft.onExpense,
        onTransfer: feeDraft.onTransfer,
        categoryId: feeDraft.categoryId,
        costCenterId: feeDraft.costCenterId || null,
        updatedAt: Date.now(),
      };
    }
    setBusy(true);
    try {
      await updateAccount(a.id!, { fee });
      setFeeId(null);
      setFeeDraft(null);
      await load();
    } catch (err) {
      setFeeMsg(`❌ Falha ao salvar: ${(err as Error).message}`);
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
        initialBalance: parseBrCurrency(creating.initialBalance) ?? 0,
        currency: "BRL",
        archived: false,
        createdAt: Date.now(),
      });
      setCreating({ name: "", type: "checking", initialBalance: "" });
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
        <BulkBar sel={sel} onDelete={bulkDelete} busy={busy} noun="conta" />
        {accounts.length === 0 ? (
          <p className="muted">Nenhuma conta ainda. Crie a primeira abaixo.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 32 }}><SelectAllCheckbox sel={sel} /></th>
                <th>Conta</th>
                <th>Tipo</th>
                <th style={{ textAlign: "right" }}>Saldo inicial</th>
                <th style={{ textAlign: "right" }}>Movimentações</th>
                <th style={{ textAlign: "right" }}>Saldo atual</th>
                <th>Taxa</th>
                <th></th>
              </tr>
              <FilterRow defs={filterDefs} cf={cf} />
            </thead>
            <tbody>
              {cf.filtered.map((a) => {
                const bal = balanceById.get(a.id!);
                const editing = editingId === a.id;
                return (
                  <Fragment key={a.id}>
                  <tr>
                    <td><RowCheckbox sel={sel} id={a.id} /></td>
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
                            inputMode="numeric"
                            placeholder="0,00"
                            onChange={(e) =>
                              setDraft({ ...draft, initialBalance: maskBrAmount(e.target.value) })
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
                        <td className="muted">{a.fee ? describeFee(a.fee) : "—"}</td>
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
                          {a.fee ? (
                            <span>
                              {describeFee(a.fee)}
                              <span className="muted" style={{ fontSize: "0.75rem" }}>
                                {" "}
                                ({[a.fee.onExpense && "despesa", a.fee.onIncome && "receita", a.fee.onTransfer && "transf."]
                                  .filter(Boolean)
                                  .join(", ")})
                              </span>
                            </span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <button
                            style={{ background: "var(--border)" }}
                            onClick={() => startEdit(a)}
                          >
                            Editar
                          </button>{" "}
                          <button
                            style={{ background: "var(--border)" }}
                            onClick={() => (feeId === a.id ? setFeeId(null) : openFee(a))}
                            title="Taxa que esta conta consome em cada operação"
                          >
                            Taxa
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
                  {feeId === a.id && feeDraft && (
                    <tr>
                      <td></td>
                      <td colSpan={7}>
                        <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "0.75rem", margin: "0.25rem 0 0.5rem" }}>
                          <strong>Taxa da conta {a.name}</strong>
                          <p className="muted" style={{ margin: "0.25rem 0 0.6rem", fontSize: "0.82rem" }}>
                            Em cada operação marcada, a conta consome o percentual + a taxa fixa. Despesa: sai o valor
                            + a taxa. Receita: entra o valor − a taxa. Transferência: chega no destino o valor − a
                            taxa. A taxa vira um lançamento à parte nesta categoria. Ao corrigir a taxa num
                            lançamento, o novo percentual passa a valer aqui.
                          </p>
                          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-end" }}>
                            <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                              <span className="muted" style={{ fontSize: "0.8rem" }}>Percentual (%)</span>
                              <input
                                inputMode="decimal"
                                value={feeDraft.percent}
                                onChange={(e) => setFeeDraft({ ...feeDraft, percent: e.target.value.replace(/[^\d,.]/g, "") })}
                                placeholder="ex.: 2,5"
                                style={{ ...fieldStyle, width: 90, textAlign: "right" }}
                              />
                            </label>
                            <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                              <span className="muted" style={{ fontSize: "0.8rem" }}>Taxa fixa (R$)</span>
                              <input
                                inputMode="numeric"
                                value={feeDraft.fixed}
                                onChange={(e) => setFeeDraft({ ...feeDraft, fixed: maskBrAmount(e.target.value) })}
                                placeholder="0,00"
                                style={{ ...fieldStyle, width: 100, textAlign: "right" }}
                              />
                            </label>
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                              <span className="muted" style={{ fontSize: "0.8rem" }}>Vale em</span>
                              <div style={{ display: "flex", gap: "0.75rem", padding: "0.35rem 0" }}>
                                {([
                                  ["onExpense", "Despesa"],
                                  ["onIncome", "Receita"],
                                  ["onTransfer", "Transferência"],
                                ] as const).map(([k, label]) => (
                                  <label key={k} style={{ display: "flex", gap: "0.3rem", alignItems: "center" }}>
                                    <input
                                      type="checkbox"
                                      checked={feeDraft[k]}
                                      onChange={(e) => setFeeDraft({ ...feeDraft, [k]: e.target.checked })}
                                    />
                                    {label}
                                  </label>
                                ))}
                              </div>
                            </div>
                            <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                              <span className="muted" style={{ fontSize: "0.8rem" }}>Centro de custo da taxa</span>
                              <select
                                value={feeDraft.costCenterId}
                                onChange={(e) => setFeeDraft({ ...feeDraft, costCenterId: e.target.value, categoryId: "" })}
                              >
                                <option value="">Escolha…</option>
                                {costCenters.map((c) => (
                                  <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                              </select>
                            </label>
                            <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                              <span className="muted" style={{ fontSize: "0.8rem" }}>Categoria da taxa</span>
                              <select
                                value={feeDraft.categoryId}
                                onChange={(e) => setFeeDraft({ ...feeDraft, categoryId: e.target.value })}
                              >
                                <option value="">Escolha…</option>
                                {expenseMains
                                  .filter((c) => !feeDraft.costCenterId || (c.costCenterId ?? "") === feeDraft.costCenterId)
                                  .map((c) => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                  ))}
                              </select>
                            </label>
                            <button type="button" style={{ background: "var(--border)" }} disabled={busy} onClick={() => void createFeeCategory(a)}>
                              + Criar “Taxa {a.name}”
                            </button>
                          </div>
                          <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
                            <button className="btn-primary" disabled={busy} onClick={() => void saveFee(a)}>
                              Salvar taxa
                            </button>
                            <button style={{ background: "var(--border)" }} onClick={() => setFeeId(null)}>
                              Cancelar
                            </button>
                            {a.fee && (
                              <button
                                style={{ background: "var(--err)" }}
                                disabled={busy}
                                onClick={() => {
                                  if (confirm(`Remover a taxa da conta ${a.name}? Os lançamentos já feitos continuam como estão.`)) {
                                    void saveFee(a, true);
                                  }
                                }}
                              >
                                Remover taxa
                              </button>
                            )}
                          </div>
                          {feeMsg && (
                            <p style={{ marginBottom: 0 }}>
                              <span className={`badge ${feeMsg.startsWith("✅") ? "ok" : "warn"}`}>{feeMsg}</span>
                            </p>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
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
            placeholder="Saldo inicial 0,00"
            inputMode="numeric"
            value={creating.initialBalance}
            onChange={(e) => setCreating({ ...creating, initialBalance: maskBrAmount(e.target.value) })}
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
