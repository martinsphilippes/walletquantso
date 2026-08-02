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
  mergeCostCenters,
} from "@/services/cost-centers";
import { countReferences } from "@/lib/references/usage";
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

  async function del(c: CostCenter) {
    const used = usage.get(c.id!) ?? 0;
    if (used > 0) {
      setError(
        `"${c.name}" está em uso (${used} lançamento(s)/título(s)). Use "Mesclar" em vez de excluir.`,
      );
      return;
    }
    if (!confirm(`Excluir o centro de custo "${c.name}"?`)) return;
    setBusy(true);
    setError("");
    try {
      await removeCostCenter(c.id!);
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
        {items.length === 0 ? (
          <p className="muted">
            Nenhum centro de custo ainda. Centros de custo ajudam a agrupar
            lançamentos por projeto, obra, filial ou finalidade. Crie o primeiro abaixo.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Centro de custo</th>
                <th style={{ textAlign: "right" }}>Uso</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => {
                const editing = editingId === c.id;
                const merging = mergingId === c.id;
                const others = items.filter((o) => o.id !== c.id);
                return (
                  <tr key={c.id}>
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
                              <button style={{ background: "var(--err)" }} onClick={() => del(c)}>
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
