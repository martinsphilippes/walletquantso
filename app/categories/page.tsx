"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LoginGate } from "@/components/LoginGate";
import { useAuth } from "@/services/auth-context";
import { listCategories, listCostCenters, listTransactions } from "@/services/firestore";
import { listBills } from "@/services/bills";
import {
  createCategory,
  updateCategory,
  removeCategory,
  deleteCategoryDeep,
  mergeCategories,
} from "@/services/categories";
import { computeCategoryUsage } from "@/lib/categories/usage";
import { useColumnFilters, FilterRow, type ColFilterDef } from "@/components/ColumnFilter";
import { useBulkSelect, SelectAllCheckbox, RowCheckbox, BulkBar } from "@/components/BulkSelect";
import { effectiveCostCenterId } from "@/lib/categories/tree";
import type { Bill, Category, CostCenter, Transaction, TransactionType } from "@/types";

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
  costCenterId: string;
}

const EMPTY_DRAFT: Draft = { name: "", kind: "expense", parentId: "", costCenterId: "" };

function Categories() {
  const { user } = useAuth();
  const [cats, setCats] = useState<Category[]>([]);
  const [centers, setCenters] = useState<CostCenter[]>([]);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [mergingId, setMergingId] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState("");
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null);
  const [creating, setCreating] = useState<Draft>(EMPTY_DRAFT);

  const load = useCallback(async () => {
    if (!user) return;
    setError("");
    setLoading(true);
    try {
      const [c, cc, t, pay, rec] = await Promise.all([
        listCategories(user.uid),
        listCostCenters(user.uid),
        listTransactions(user.uid),
        listBills(user.uid, "payable"),
        listBills(user.uid, "receivable"),
      ]);
      setCats(c);
      setCenters(cc);
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
  const catById = useMemo(() => new Map(cats.map((c) => [c.id!, c])), [cats]);
  const centerName = useMemo(() => new Map(centers.map((c) => [c.id!, c.name])), [centers]);
  const childCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cats) if (c.parentId) m.set(c.parentId, (m.get(c.parentId) ?? 0) + 1);
    return m;
  }, [cats]);

  // Centro efetivo de cada categoria (próprio ou herdado do pai).
  const centerOf = (c: Category) => effectiveCostCenterId(c, catById);
  const missingCenter = useMemo(
    () => cats.filter((c) => !c.parentId && !c.costCenterId).length,
    [cats],
  );

  const filterDefs: ColFilterDef<Category>[] = [
    { key: "select", type: "none" },
    { key: "name", value: (c) => c.name },
    { key: "kind", type: "select", value: (c) => KIND_LABELS[c.kind] },
    {
      key: "center",
      type: "select",
      value: (c) => {
        const id = effectiveCostCenterId(c, catById);
        return id ? (centerName.get(id) ?? "") : "";
      },
    },
    { key: "parent", type: "select", value: (c) => (c.parentId ? (nameById.get(c.parentId) ?? "") : "") },
    { key: "usage", value: (c) => String(usage.get(c.id!) ?? 0), align: "right" },
    { key: "actions", type: "none" },
  ];
  const cf = useColumnFilters(cats, filterDefs);
  const sel = useBulkSelect(cf.filtered, (c) => c.id);

  async function bulkDelete() {
    if (!user || sel.count === 0) return;
    setBusy(true);
    setError("");
    const byId = new Map(cats.map((c) => [c.id!, c]));
    try {
      for (const id of sel.selectedIds) {
        const c = byId.get(id);
        if (!c) continue;
        if (isBlocked(c)) await deleteCategoryDeep(user.uid, id);
        else await removeCategory(id);
      }
      sel.clear();
      setConfirmDelId(null);
      await load();
    } catch (err) {
      setError(`Falha ao excluir: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  function startEdit(c: Category) {
    setMergingId(null);
    setEditingId(c.id!);
    setDraft({
      name: c.name,
      kind: c.kind,
      parentId: c.parentId ?? "",
      costCenterId: c.costCenterId ?? "",
    });
  }

  async function saveEdit(id: string) {
    // Regra: categoria principal precisa de centro de custo; subcategoria
    // herda o centro do pai (não guarda um próprio).
    if (!draft.parentId && !draft.costCenterId) {
      setError("Toda categoria precisa estar atrelada a um centro de custo.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await updateCategory(id, {
        name: draft.name.trim(),
        kind: draft.kind,
        parentId: draft.parentId || null,
        costCenterId: draft.parentId ? null : draft.costCenterId || null,
      });
      setEditingId(null);
      await load();
    } catch (err) {
      setError(`Falha ao salvar: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const isBlocked = (c: Category) =>
    (usage.get(c.id!) ?? 0) > 0 || (childCount.get(c.id!) ?? 0) > 0;

  function delMessage(c: Category): string {
    const used = usage.get(c.id!) ?? 0;
    const kids = childCount.get(c.id!) ?? 0;
    const parts: string[] = [];
    if (kids > 0) parts.push(`${kids} subcategoria(s) serão excluídas`);
    if (used > 0) parts.push(`${used} lançamento(s)/título(s) ficarão sem categoria`);
    if (parts.length === 0) return `Excluir "${c.name}"?`;
    return `"${c.name}": ${parts.join(" e ")}. Excluir tudo?`;
  }

  // No native confirm() here: some mobile browsers suppress repeated dialogs,
  // which silently blocks the deletion. Confirmation is done inline instead.
  async function doDelete(c: Category) {
    if (!user) return;
    setBusy(true);
    setError("");
    try {
      if (isBlocked(c)) {
        const res = await deleteCategoryDeep(user.uid, c.id!);
        setError(
          `Excluída "${c.name}"${
            res.deletedCategories > 1 ? ` e ${res.deletedCategories - 1} subcategoria(s)` : ""
          }. ${res.unassigned} lançamento(s)/título(s) ficaram sem categoria.`,
        );
      } else {
        await removeCategory(c.id!);
      }
      setConfirmDelId(null);
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
    if (!creating.parentId && !creating.costCenterId) {
      setError("Toda categoria precisa estar atrelada a um centro de custo.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await createCategory({
        ownerId: user.uid,
        name: creating.name.trim(),
        kind: creating.kind,
        parentId: creating.parentId || null,
        costCenterId: creating.parentId ? null : creating.costCenterId || null,
        createdAt: Date.now(),
      });
      setCreating(EMPTY_DRAFT);
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
        {missingCenter > 0 && (
          <p className="badge warn" style={{ marginBottom: "0.75rem" }}>
            ⚠ {missingCenter} categoria(s) ainda sem centro de custo. Toque em Editar e escolha o
            centro de cada uma.
          </p>
        )}
        <BulkBar sel={sel} onDelete={bulkDelete} busy={busy} noun="categoria" />
        {cats.length === 0 ? (
          <p className="muted">Nenhuma categoria ainda. Crie a primeira abaixo.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 32 }}><SelectAllCheckbox sel={sel} /></th>
                <th>Categoria</th>
                <th>Tipo</th>
                <th>Centro de custo</th>
                <th>Subcategoria de</th>
                <th style={{ textAlign: "right" }}>Uso</th>
                <th></th>
              </tr>
              <FilterRow defs={filterDefs} cf={cf} />
            </thead>
            <tbody>
              {cf.filtered.map((c) => {
                const editing = editingId === c.id;
                const merging = mergingId === c.id;
                const mergeOptions = cats.filter((o) => o.id !== c.id);
                // Pai só pode ser categoria principal (nunca uma subcategoria),
                // e quem já tem subcategorias não pode virar subcategoria.
                const parentOptions = cats.filter((o) => o.id !== c.id && !o.parentId);
                const hasChildren = (childCount.get(c.id!) ?? 0) > 0;
                return (
                  <tr key={c.id}>
                    <td><RowCheckbox sel={sel} id={c.id} /></td>
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
                          {draft.parentId ? (
                            <span className="muted">herda do pai</span>
                          ) : (
                            <select
                              value={draft.costCenterId}
                              onChange={(e) => setDraft({ ...draft, costCenterId: e.target.value })}
                            >
                              <option value="">— escolha o centro —</option>
                              {centers.map((o) => (
                                <option key={o.id} value={o.id}>
                                  {o.name}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>
                        <td>
                          {hasChildren ? (
                            <span className="muted">— tem subcategorias —</span>
                          ) : (
                            <select
                              value={draft.parentId}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  parentId: e.target.value,
                                  costCenterId: e.target.value ? "" : draft.costCenterId,
                                })
                              }
                            >
                              <option value="">— nenhuma (principal) —</option>
                              {parentOptions.map((o) => (
                                <option key={o.id} value={o.id}>
                                  {o.name}
                                </option>
                              ))}
                            </select>
                          )}
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
                        <td>
                          {(() => {
                            const cid = centerOf(c);
                            if (!cid) return <span className="badge warn">⚠ definir</span>;
                            const label = centerName.get(cid) ?? "—";
                            return c.parentId ? (
                              <span className="muted">{label} (herdado)</span>
                            ) : (
                              label
                            );
                          })()}
                        </td>
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
                                {mergeOptions.map((o) => (
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
                          ) : confirmDelId === c.id ? (
                            <>
                              <span className="muted" style={{ marginRight: "0.5rem" }}>
                                {delMessage(c)}
                              </span>
                              <button
                                style={{ background: "var(--err)" }}
                                disabled={busy}
                                onClick={() => doDelete(c)}
                              >
                                {isBlocked(c) ? "Excluir tudo" : "Confirmar exclusão"}
                              </button>{" "}
                              <button
                                style={{ background: "var(--border)" }}
                                onClick={() => setConfirmDelId(null)}
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
                                onClick={() => {
                                  setEditingId(null);
                                  setMergingId(null);
                                  setConfirmDelId(c.id!);
                                }}
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
        <p className="muted" style={{ marginTop: 0 }}>
          Toda categoria pertence a um centro de custo. Uma subcategoria pertence a uma categoria
          (e herda o centro dela).
        </p>
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
            onChange={(e) =>
              setCreating({
                ...creating,
                parentId: e.target.value,
                costCenterId: e.target.value ? "" : creating.costCenterId,
              })
            }
          >
            <option value="">Categoria principal</option>
            {cats
              .filter((o) => !o.parentId)
              .map((o) => (
                <option key={o.id} value={o.id}>
                  Subcategoria de: {o.name}
                </option>
              ))}
          </select>
          {!creating.parentId && (
            <select
              value={creating.costCenterId}
              onChange={(e) => setCreating({ ...creating, costCenterId: e.target.value })}
              required
            >
              <option value="">Centro de custo…</option>
              {centers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
          <button type="submit" disabled={busy}>
            Adicionar
          </button>
        </form>
        {centers.length === 0 && (
          <p className="muted">
            Você ainda não tem centros de custo — cadastre um em “Centros de custo” para poder
            criar categorias.
          </p>
        )}
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
