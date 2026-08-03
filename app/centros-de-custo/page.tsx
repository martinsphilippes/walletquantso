"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LoginGate } from "@/components/LoginGate";
import { useAuth } from "@/services/auth-context";
import { listCostCenters, listTransactions } from "@/services/firestore";
import { listBills } from "@/services/bills";
import {
  createCostCenter,
  updateCostCenter,
  removeCostCenter,
  deleteCostCenterDeep,
  mergeCostCenters,
} from "@/services/cost-centers";
import { countReferences } from "@/lib/references/usage";
import { useColumnFilters, FilterRow, type ColFilterDef } from "@/components/ColumnFilter";
import { useBulkSelect, SelectAllCheckbox, RowCheckbox, BulkBar } from "@/components/BulkSelect";
import type { Bill, CostCenter, Transaction } from "@/types";

export default function CostCentersPage() {
  return (
    <>
      <h1>Centros de custo</h1>
      <LoginGate>
        <CostCenters />
      </LoginGate>
    </>
  );
}

function CostCenters() {
  const { user } = useAuth();
  const [items, setItems] = useState<CostCenter[]>([]);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [mergingId, setMergingId] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState("");
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    setError("");
    setLoading(true);
    try {
      const [c, t, pay, rec] = await Promise.all([
        listCostCenters(user.uid),
        listTransactions(user.uid),
        listBills(user.uid, "payable"),
        listBills(user.uid, "receivable"),
      ]);
      c.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
      setItems(c);
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

  const usage = useMemo(() => countReferences([...txs, ...bills], "costCenterId"), [txs, bills]);

  const filterDefs: ColFilterDef<CostCenter>[] = [
    { key: "select", type: "none" },
    { key: "name", value: (c) => c.name },
    { key: "usage", value: (c) => String(usage.get(c.id!) ?? 0), align: "right" },
    { key: "actions", type: "none" },
  ];
  const cf = useColumnFilters(items, filterDefs);
  const sel = useBulkSelect(cf.filtered, (c) => c.id);

  async function bulkDelete() {
    if (!user || sel.count === 0) return;
    setBusy(true);
    setError("");
    const byId = new Map(items.map((c) => [c.id!, c]));
    try {
      for (const id of sel.selectedIds) {
        const c = byId.get(id);
        if (!c) continue;
        if (isBlocked(c)) await deleteCostCenterDeep(user.uid, id);
        else await removeCostCenter(id);
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

  function startEdit(c: CostCenter) {
    setMergingId(null);
    setEditingId(c.id!);
    setDraftName(c.name);
  }

  async function saveEdit(id: string) {
    if (!draftName.trim()) return;
    setBusy(true);
    setError("");
    try {
      await updateCostCenter(id, { name: draftName.trim() });
      setEditingId(null);
      await load();
    } catch (err) {
      setError(`Falha ao salvar: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const isBlocked = (c: CostCenter) => (usage.get(c.id!) ?? 0) > 0;

  function delMessage(c: CostCenter): string {
    const used = usage.get(c.id!) ?? 0;
    if (used > 0) {
      return `"${c.name}": ${used} lançamento(s)/título(s) ficarão sem centro. Excluir?`;
    }
    return `Excluir "${c.name}"?`;
  }

  // Inline confirmation (no native confirm(), which some mobile browsers suppress).
  async function doDelete(c: CostCenter) {
    if (!user) return;
    setBusy(true);
    setError("");
    try {
      if (isBlocked(c)) {
        const res = await deleteCostCenterDeep(user.uid, c.id!);
        setError(`Excluído "${c.name}". ${res.unassigned} lançamento(s)/título(s) ficaram sem centro.`);
      } else {
        await removeCostCenter(c.id!);
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
      const moved = await mergeCostCenters(user.uid, sourceId, mergeTarget);
      setMergingId(null);
      setMergeTarget("");
      await load();
      setError(`Mesclados: ${moved} lançamento(s) reatribuído(s).`);
    } catch (err) {
      setError(`Falha ao mesclar: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function createNew(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !newName.trim()) return;
    setBusy(true);
    setError("");
    try {
      await createCostCenter({
        ownerId: user.uid,
        name: newName.trim(),
        createdAt: Date.now(),
      });
      setNewName("");
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
        <BulkBar sel={sel} onDelete={bulkDelete} busy={busy} noun="centro" />
        {items.length === 0 ? (
          <p className="muted">
            Nenhum centro de custo ainda. Centros de custo ajudam a agrupar
            lançamentos por projeto, obra, filial ou finalidade. Crie o primeiro abaixo.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 32 }}><SelectAllCheckbox sel={sel} /></th>
                <th>Centro de custo</th>
                <th style={{ textAlign: "right" }}>Uso</th>
                <th></th>
              </tr>
              <FilterRow defs={filterDefs} cf={cf} />
            </thead>
            <tbody>
              {cf.filtered.map((c) => {
                const editing = editingId === c.id;
                const merging = mergingId === c.id;
                const others = items.filter((o) => o.id !== c.id);
                return (
                  <tr key={c.id}>
                    <td><RowCheckbox sel={sel} id={c.id} /></td>
                    {editing ? (
                      <>
                        <td>
                          <input
                            value={draftName}
                            onChange={(e) => setDraftName(e.target.value)}
                            style={fieldStyle}
                          />
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
                        <td style={{ textAlign: "right" }}>{usage.get(c.id!) ?? 0}</td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          {merging ? (
                            <>
                              <select
                                value={mergeTarget}
                                onChange={(e) => setMergeTarget(e.target.value)}
                              >
                                <option value="">— mesclar em… —</option>
                                {others.map((o) => (
                                  <option key={o.id} value={o.id}>
                                    {o.name}
                                  </option>
                                ))}
                              </select>{" "}
                              <button
                                disabled={busy || !mergeTarget}
                                onClick={() => doMerge(c.id!)}
                              >
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
                                {isBlocked(c) ? "Excluir mesmo assim" : "Confirmar exclusão"}
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
                              {others.length > 0 && (
                                <>
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
                                </>
                              )}
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
        <h2>Novo centro de custo</h2>
        <form onSubmit={createNew} style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <input
            placeholder="Nome (ex.: Casa, Empresa, Projeto X)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            required
            style={{ ...fieldStyle, minWidth: 260 }}
          />
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
