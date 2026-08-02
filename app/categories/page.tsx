"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LoginGate } from "@/components/LoginGate";
import { useAuth } from "@/services/auth-context";
import { listCategories, listTransactions } from "@/services/firestore";
import { listBills } from "@/services/bills";
import {
  createCategory,
  updateCategory,
  removeCategory,
  mergeCategories,
} from "@/services/categories";
import { computeCategoryUsage } from "@/lib/categories/usage";
import type { Bill, Category, Transaction, TransactionType } from "@/types";

const KIND_LABELS: Record<TransactionType, string> = {
  income: "Receita",
  expense: "Despesa",
  transfer: "Transferência",
};
const KINDS = Object.keys(KIND_LABELS) as TransactionType[];

export default function CategoriesPage() {
  return (
    <>
      <h1>Categorias</h1>
      <LoginGate>
        <Categories />
      </LoginGate>
    </>
  );
}

interface Draft {
  name: string;
  kind: TransactionType;
  parentId: string;
}

function Categories() {
  const { user } = useAuth();
  const [cats, setCats] = useState<Category[]>([]);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ name: "", kind: "expense", parentId: "" });
  const [mergingId, setMergingId] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState("");
  const [creating, setCreating] = useState<Draft>({ name: "", kind: "expense", parentId: "" });

  const load = useCallback(async () => {
    if (!user) return;
    setError("");
    setLoading(true);
    try {
      const [c, t, pay, rec] = await Promise.all([
        listCategories(user.uid),
        listTransactions(user.uid),
        listBills(user.uid, "payable"),
        listBills(user.uid, "receivable"),
      ]);
      setCats(c);
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

  const usage = useMemo(() => computeCategoryUsage([...txs, ...bills]), [txs, bills]);
  const nameById = useMemo(() => new Map(cats.map((c) => [c.id!, c.name])), [cats]);
  const childCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cats) if (c.parentId) m.set(c.parentId, (m.get(c.parentId) ?? 0) + 1);
    return m;
  }, [cats]);

  function startEdit(c: Category) {
    setMergingId(null);
    setEditingId(c.id!);
    setDraft({ name: c.name, kind: c.kind, parentId: c.parentId ?? "" });
  }

  async function saveEdit(id: string) {
    setBusy(true);
    setError("");
    try {
      await updateCategory(id, {
        name: draft.name.trim(),
        kind: draft.kind,
        parentId: draft.parentId || null,
      });
      setEditingId(null);
      await load();
    } catch (err) {
      setError(`Falha ao salvar: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function del(c: Category) {
    const used = usage.get(c.id!) ?? 0;
    const kids = childCount.get(c.id!) ?? 0;
    if (used > 0 || kids > 0) {
      setError(
        `"${c.name}" está em uso (${used} lançamento(s)/título(s), ${kids} subcategoria(s)). Use "Mesclar" em vez de excluir.`,
      );
      return;
    }
    if (!confirm(`Excluir a categoria "${c.name}"?`)) return;
    setBusy(true);
    setError("");
    try {
      await removeCategory(c.id!);
      await load();
    } catch (err) {
      setError(`Falha ao excluir: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function doMerge(sourceId: string) {
    if (!user || !mergeTarget) return;
    setBusy(true);
    setError("");
    try {
      const moved = await mergeCategories(user.uid, sourceId, mergeTarget);
      setMergingId(null);
      setMergeTarget("");
      await load();
      setError(`Mescladas: ${moved} lançamento(s) reatribuído(s).`);
    } catch (err) {
      setError(`Falha ao mesclar: ${(err as Error).message}`);
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
      await createCategory({
        ownerId: user.uid,
        name: creating.name.trim(),
        kind: creating.kind,
        parentId: creating.parentId || null,
        createdAt: Date.now(),
      });
      setCreating({ name: "", kind: "expense", parentId: "" });
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
      {error && <p className="badge warn">{error}</p>}

      <div className="panel">
        {cats.length === 0 ? (
          <p className="muted">Nenhuma categoria ainda. Crie a primeira abaixo.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Categoria</th>
                <th>Tipo</th>
                <th>Subcategoria de</th>
                <th style={{ textAlign: "right" }}>Uso</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {cats.map((c) => {
                const editing = editingId === c.id;
                const merging = mergingId === c.id;
                const parentOptions = cats.filter((o) => o.id !== c.id);
                return (
                  <tr key={c.id}>
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
                            value={draft.kind}
                            onChange={(e) =>
                              setDraft({ ...draft, kind: e.target.value as TransactionType })
                            }
                          >
                            {KINDS.map((k) => (
                              <option key={k} value={k}>
                                {KIND_LABELS[k]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            value={draft.parentId}
                            onChange={(e) => setDraft({ ...draft, parentId: e.target.value })}
                          >
                            <option value="">— nenhuma —</option>
                            {parentOptions.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td style={{ textAlign: "right" }} className="muted">
                          {usage.get(c.id!) ?? 0}
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <button disabled={busy} onClick={() => saveEdit(c.id!)}>
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
                        <td>{c.name}</td>
                        <td>{KIND_LABELS[c.kind]}</td>
                        <td>{c.parentId ? (nameById.get(c.parentId) ?? "—") : "—"}</td>
                        <td style={{ textAlign: "right" }}>{usage.get(c.id!) ?? 0}</td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          {merging ? (
                            <>
                              <select
                                value={mergeTarget}
                                onChange={(e) => setMergeTarget(e.target.value)}
                              >
                                <option value="">— mesclar em… —</option>
                                {parentOptions.map((o) => (
                                  <option key={o.id} value={o.id}>
                                    {o.name}
                                  </option>
                                ))}
                              </select>{" "}
                              <button disabled={busy || !mergeTarget} onClick={() => doMerge(c.id!)}>
                                Confirmar
                              </button>{" "}
                              <button
                                style={{ background: "var(--border)" }}
                                onClick={() => setMergingId(null)}
                              >
                                Cancelar
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                style={{ background: "var(--border)" }}
                                onClick={() => startEdit(c)}
                              >
                                Editar
                              </button>{" "}
                              <button
                                className="btn-primary"
                                onClick={() => {
                                  setEditingId(null);
                                  setMergeTarget("");
                                  setMergingId(c.id!);
                                }}
                              >
                                Mesclar
                              </button>{" "}
                              <button
                                style={{ background: "var(--err)" }}
                                onClick={() => del(c)}
                              >
                                Excluir
                              </button>
                            </>
                          )}
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
        <h2>Nova categoria</h2>
        <form onSubmit={createNew} style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <input
            placeholder="Nome"
            value={creating.name}
            onChange={(e) => setCreating({ ...creating, name: e.target.value })}
            required
            style={fieldStyle}
          />
          <select
            value={creating.kind}
            onChange={(e) => setCreating({ ...creating, kind: e.target.value as TransactionType })}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
          <select
            value={creating.parentId}
            onChange={(e) => setCreating({ ...creating, parentId: e.target.value })}
          >
            <option value="">Categoria principal</option>
            {cats.map((o) => (
              <option key={o.id} value={o.id}>
                Sub de: {o.name}
              </option>
            ))}
          </select>
          <button type="submit" disabled={busy}>
            Adicionar
          </button>
        </form>
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
