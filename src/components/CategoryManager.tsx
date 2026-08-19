"use client";

// WalletQuantso — shared manager for the "Categorias" and "Subcategorias"
// screens. The hierarchy is: cost center → category → subcategory. The
// "main" mode manages top-level categories (each tied to a cost center);
// the "sub" mode manages subcategories (each tied to a parent category,
// inheriting its cost center and type). Both operate on the same Firestore
// collection — a subcategory is a category with `parentId` set.

import { useCallback, useEffect, useMemo, useState } from "react";
import { loadErrorMessage } from "@/lib/errors";
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
import { effectiveCostCenterId } from "@/lib/categories/tree";
import { useColumnFilters, FilterRow, type ColFilterDef } from "@/components/ColumnFilter";
import { useBulkSelect, SelectAllCheckbox, RowCheckbox, BulkBar } from "@/components/BulkSelect";
import type { Bill, Category, CostCenter, Transaction, TransactionType } from "@/types";

const KIND_LABELS: Record<TransactionType, string> = {
  income: "Receita",
  expense: "Despesa",
  transfer: "Transferência",
};
const KINDS = Object.keys(KIND_LABELS) as TransactionType[];

export type CategoryManagerMode = "main" | "sub";

interface Draft {
  name: string;
  kind: TransactionType;
  parentId: string;
  costCenterId: string;
}

const EMPTY_DRAFT: Draft = { name: "", kind: "expense", parentId: "", costCenterId: "" };

export function CategoryManager({ mode }: { mode: CategoryManagerMode }) {
  const isSub = mode === "sub";
  const noun = isSub ? "subcategoria" : "categoria";

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
      setError(`Falha ao carregar: ${loadErrorMessage(err)}`);
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

  // Only this screen's slice: main = categorias principais, sub = subcategorias.
  const rows = useMemo(
    () => cats.filter((c) => (isSub ? !!c.parentId : !c.parentId)),
    [cats, isSub],
  );
  const mains = useMemo(() => cats.filter((c) => !c.parentId), [cats]);

  const centerOf = (c: Category) => effectiveCostCenterId(c, catById);
  const centerLabel = (c: Category) => {
    const id = centerOf(c);
    return id ? (centerName.get(id) ?? "") : "";
  };
  const missingCenter = useMemo(
    () => (isSub ? 0 : rows.filter((c) => !c.costCenterId).length),
    [rows, isSub],
  );

  const filterDefs: ColFilterDef<Category>[] = [
    { key: "select", type: "none" },
    { key: "center", type: "select", value: (c) => centerLabel(c) },
    ...(isSub
      ? [
          {
            key: "parent",
            type: "select",
            value: (c) => (c.parentId ? (nameById.get(c.parentId) ?? "") : ""),
          } as ColFilterDef<Category>,
        ]
      : []),
    { key: "name", value: (c) => c.name },
    { key: "kind", type: "select", value: (c) => KIND_LABELS[c.kind] },
    { key: "usage", value: (c) => String(usage.get(c.id!) ?? 0), align: "right" },
    { key: "actions", type: "none" },
  ];
  const cf = useColumnFilters(rows, filterDefs);
  const sel = useBulkSelect(cf.filtered, (c) => c.id);

  const isBlocked = (c: Category) =>
    (usage.get(c.id!) ?? 0) > 0 || (childCount.get(c.id!) ?? 0) > 0;

  async function bulkDelete() {
    if (!user || sel.count === 0) return;
    setBusy(true);
    setError("");
    try {
      for (const id of sel.selectedIds) {
        const c = catById.get(id);
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
    if (isSub && !draft.parentId) {
      setError("Toda subcategoria precisa estar atrelada a uma categoria.");
      return;
    }
    if (!isSub && !draft.costCenterId) {
      setError("Toda categoria precisa estar atrelada a um centro de custo.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      // Sub: herda tipo e centro do pai; principal: guarda o próprio centro.
      const parent = isSub ? catById.get(draft.parentId) : undefined;
      await updateCategory(id, {
        name: draft.name.trim(),
        kind: isSub ? (parent?.kind ?? draft.kind) : draft.kind,
        parentId: isSub ? draft.parentId : null,
        costCenterId: isSub ? null : draft.costCenterId || null,
      });
      setEditingId(null);
      await load();
    } catch (err) {
      setError(`Falha ao salvar: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

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

  // ── Edição em massa — inline na barra de seleção, como em Lançamentos.
  // Nas categorias aplica o centro de custo; nas subcategorias, a categoria.
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkValue, setBulkValue] = useState("");
  const [bulkMsg, setBulkMsg] = useState("");

  async function applyBulk() {
    if (!user || sel.count === 0) return;
    if (!bulkValue) {
      setBulkMsg(isSub ? "Escolha a categoria a aplicar." : "Escolha o centro de custo a aplicar.");
      return;
    }
    setBusy(true);
    setBulkMsg("");
    setError("");
    try {
      const parent = isSub ? catById.get(bulkValue) : undefined;
      for (const id of sel.selectedIds) {
        if (isSub) {
          // Sub não pode virar filha de si mesma (não acontece: bulkValue é principal).
          await updateCategory(id, {
            parentId: bulkValue,
            kind: parent?.kind ?? "expense",
            costCenterId: null,
          });
        } else {
          await updateCategory(id, { costCenterId: bulkValue });
        }
      }
      setBulkMsg(`✅ ${sel.count} ${noun}(s) atualizada(s).`);
      sel.clear();
      setBulkOpen(false);
      setBulkValue("");
      await load();
    } catch (err) {
      setBulkMsg(`❌ Falha ao aplicar: ${(err as Error).message}`);
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
    if (isSub && !creating.parentId) {
      setError("Escolha a categoria da subcategoria.");
      return;
    }
    if (!isSub && !creating.costCenterId) {
      setError("Toda categoria precisa estar atrelada a um centro de custo.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const parent = isSub ? catById.get(creating.parentId) : undefined;
      await createCategory({
        ownerId: user.uid,
        name: creating.name.trim(),
        kind: isSub ? (parent?.kind ?? "expense") : creating.kind,
        parentId: isSub ? creating.parentId : null,
        costCenterId: isSub ? null : creating.costCenterId || null,
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
        <BulkBar
          sel={sel}
          onDelete={bulkDelete}
          busy={busy}
          noun={noun}
          extra={
            !bulkOpen ? (
              <>
                <button
                  style={{ background: "var(--border)" }}
                  onClick={() => {
                    setBulkOpen(true);
                    setBulkValue("");
                    setBulkMsg("");
                  }}
                >
                  {isSub ? "Editar categoria" : "Editar centro de custo"}
                </button>
                {bulkMsg && (
                  <span
                    className={`badge ${bulkMsg.startsWith("✅") ? "ok" : "warn"}`}
                    style={{ fontSize: "0.85rem" }}
                  >
                    {bulkMsg}
                  </span>
                )}
              </>
            ) : (
              <>
                <span>{isSub ? "Nova categoria:" : "Novo centro de custo:"}</span>
                <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}>
                  <option value="">— escolha —</option>
                  {(isSub ? mains : centers).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
                <button disabled={busy} onClick={applyBulk}>
                  {busy ? "Aplicando…" : `Aplicar a ${sel.count} selecionada(s)`}
                </button>
                <button
                  style={{ background: "var(--border)" }}
                  disabled={busy}
                  onClick={() => {
                    setBulkOpen(false);
                    setBulkValue("");
                    setBulkMsg("");
                  }}
                >
                  Cancelar
                </button>
                {bulkMsg && (
                  <span
                    className={`badge ${bulkMsg.startsWith("✅") ? "ok" : "warn"}`}
                    style={{ fontSize: "0.85rem" }}
                  >
                    {bulkMsg}
                  </span>
                )}
              </>
            )
          }
        />
        {sel.count === 0 && bulkMsg && (
          <p style={{ marginBottom: "0.75rem" }}>
            <span className={`badge ${bulkMsg.startsWith("✅") ? "ok" : "warn"}`}>{bulkMsg}</span>
          </p>
        )}
        {rows.length === 0 ? (
          <p className="muted">
            {isSub
              ? "Nenhuma subcategoria ainda. Crie a primeira abaixo, atrelada a uma categoria."
              : "Nenhuma categoria ainda. Crie a primeira abaixo."}
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 32 }}><SelectAllCheckbox sel={sel} /></th>
                <th>Centro de custo</th>
                {isSub && <th>Categoria</th>}
                <th>{isSub ? "Subcategoria" : "Categoria"}</th>
                <th>Tipo</th>
                <th style={{ textAlign: "right" }}>Uso</th>
                <th></th>
              </tr>
              <FilterRow defs={filterDefs} cf={cf} />
            </thead>
            <tbody>
              {cf.filtered.map((c) => {
                const editing = editingId === c.id;
                const merging = mergingId === c.id;
                const mergeOptions = rows.filter((o) => o.id !== c.id);
                return (
                  <tr key={c.id}>
                    <td><RowCheckbox sel={sel} id={c.id} /></td>
                    {editing ? (
                      <>
                        <td>
                          {isSub ? (
                            <span className="muted">
                              {(() => {
                                const parent = catById.get(draft.parentId);
                                const id = parent
                                  ? effectiveCostCenterId(parent, catById)
                                  : null;
                                return id
                                  ? `${centerName.get(id) ?? "—"} (herdado)`
                                  : "herda da categoria";
                              })()}
                            </span>
                          ) : (
                            <select
                              value={draft.costCenterId}
                              onChange={(e) =>
                                setDraft({ ...draft, costCenterId: e.target.value })
                              }
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
                        {isSub && (
                          <td>
                            <select
                              value={draft.parentId}
                              onChange={(e) => setDraft({ ...draft, parentId: e.target.value })}
                            >
                              <option value="">— escolha a categoria —</option>
                              {mains.map((o) => (
                                <option key={o.id} value={o.id}>
                                  {o.name}
                                </option>
                              ))}
                            </select>
                          </td>
                        )}
                        <td>
                          <input
                            value={draft.name}
                            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                            style={fieldStyle}
                          />
                        </td>
                        <td>
                          {isSub ? (
                            <span className="muted">
                              {KIND_LABELS[catById.get(draft.parentId)?.kind ?? c.kind]} (da
                              categoria)
                            </span>
                          ) : (
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
                        <td>
                          {(() => {
                            const label = centerLabel(c);
                            if (!label) return <span className="badge warn">⚠ definir</span>;
                            return isSub ? <span className="muted">{label}</span> : label;
                          })()}
                        </td>
                        {isSub && <td>{c.parentId ? (nameById.get(c.parentId) ?? "—") : "—"}</td>}
                        <td>{c.name}</td>
                        <td>{KIND_LABELS[c.kind]}</td>
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
        <h2>{isSub ? "Nova subcategoria" : "Nova categoria"}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {isSub
            ? "Uma subcategoria pertence a uma categoria e herda o centro de custo e o tipo dela."
            : "Toda categoria pertence a um centro de custo. Subcategorias são criadas na tela “Subcategorias”."}
        </p>
        <form onSubmit={createNew} style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <input
            placeholder="Nome"
            value={creating.name}
            onChange={(e) => setCreating({ ...creating, name: e.target.value })}
            required
            style={fieldStyle}
          />
          {isSub ? (
            <select
              value={creating.parentId}
              onChange={(e) => setCreating({ ...creating, parentId: e.target.value })}
              required
            >
              <option value="">Categoria…</option>
              {mains.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({KIND_LABELS[o.kind]})
                </option>
              ))}
            </select>
          ) : (
            <>
              <select
                value={creating.kind}
                onChange={(e) =>
                  setCreating({ ...creating, kind: e.target.value as TransactionType })
                }
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k]}
                  </option>
                ))}
              </select>
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
            </>
          )}
          <button type="submit" disabled={busy}>
            Adicionar
          </button>
        </form>
        {isSub && mains.length === 0 && (
          <p className="muted">
            Você ainda não tem categorias — crie uma na tela “Categorias” para poder criar
            subcategorias.
          </p>
        )}
        {!isSub && centers.length === 0 && (
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
