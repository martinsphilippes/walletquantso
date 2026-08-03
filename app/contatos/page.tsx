"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LoginGate } from "@/components/LoginGate";
import { useAuth } from "@/services/auth-context";
import { listContacts, listTransactions } from "@/services/firestore";
import { listBills } from "@/services/bills";
import {
  createContact,
  updateContact,
  removeContact,
  deleteContactDeep,
  mergeContacts,
} from "@/services/contacts";
import { countReferences } from "@/lib/references/usage";
import { useColumnFilters, FilterRow, type ColFilterDef } from "@/components/ColumnFilter";
import { useBulkSelect, SelectAllCheckbox, RowCheckbox, BulkBar } from "@/components/BulkSelect";
import type { Bill, Contact, ContactKind, Transaction } from "@/types";

const KIND_LABELS: Record<ContactKind, string> = {
  person: "Pessoa",
  supplier: "Fornecedor",
  customer: "Cliente",
  company: "Empresa",
  other: "Outro",
};
const KINDS = Object.keys(KIND_LABELS) as ContactKind[];

export default function ContactsPage() {
  return (
    <>
      <h1>Pessoas e contatos</h1>
      <LoginGate>
        <Contacts />
      </LoginGate>
    </>
  );
}

interface Draft {
  name: string;
  kind: ContactKind;
  document: string;
  notes: string;
}

const emptyDraft: Draft = { name: "", kind: "person", document: "", notes: "" };

function Contacts() {
  const { user } = useAuth();
  const [items, setItems] = useState<Contact[]>([]);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [mergingId, setMergingId] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState("");
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null);
  const [creating, setCreating] = useState<Draft>(emptyDraft);

  const load = useCallback(async () => {
    if (!user) return;
    setError("");
    setLoading(true);
    try {
      const [c, t, pay, rec] = await Promise.all([
        listContacts(user.uid),
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

  const usage = useMemo(() => countReferences([...txs, ...bills], "contactId"), [txs, bills]);

  const filterDefs: ColFilterDef<Contact>[] = [
    { key: "select", type: "none" },
    { key: "name", value: (c) => c.name },
    { key: "kind", type: "select", value: (c) => KIND_LABELS[c.kind] },
    { key: "document", value: (c) => c.document ?? "" },
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
        if (isBlocked(c)) await deleteContactDeep(user.uid, id);
        else await removeContact(id);
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

  function startEdit(c: Contact) {
    setMergingId(null);
    setEditingId(c.id!);
    setDraft({
      name: c.name,
      kind: c.kind,
      document: c.document ?? "",
      notes: c.notes ?? "",
    });
  }

  async function saveEdit(id: string) {
    if (!draft.name.trim()) return;
    setBusy(true);
    setError("");
    try {
      await updateContact(id, {
        name: draft.name.trim(),
        kind: draft.kind,
        document: draft.document.trim() || null,
        notes: draft.notes.trim() || null,
      });
      setEditingId(null);
      await load();
    } catch (err) {
      setError(`Falha ao salvar: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const isBlocked = (c: Contact) => (usage.get(c.id!) ?? 0) > 0;

  function delMessage(c: Contact): string {
    const used = usage.get(c.id!) ?? 0;
    if (used > 0) {
      return `"${c.name}": ${used} lançamento(s)/título(s) ficarão sem contato. Excluir?`;
    }
    return `Excluir "${c.name}"?`;
  }

  // Inline confirmation (no native confirm(), which some mobile browsers suppress).
  async function doDelete(c: Contact) {
    if (!user) return;
    setBusy(true);
    setError("");
    try {
      if (isBlocked(c)) {
        const res = await deleteContactDeep(user.uid, c.id!);
        setError(`Excluído "${c.name}". ${res.unassigned} lançamento(s)/título(s) ficaram sem contato.`);
      } else {
        await removeContact(c.id!);
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
      const moved = await mergeContacts(user.uid, sourceId, mergeTarget);
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
    if (!user || !creating.name.trim()) return;
    setBusy(true);
    setError("");
    try {
      await createContact({
        ownerId: user.uid,
        name: creating.name.trim(),
        kind: creating.kind,
        document: creating.document.trim() || null,
        notes: creating.notes.trim() || null,
        createdAt: Date.now(),
      });
      setCreating(emptyDraft);
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
        <BulkBar sel={sel} onDelete={bulkDelete} busy={busy} noun="contato" />
        {items.length === 0 ? (
          <p className="muted">
            Nenhum contato ainda. Cadastre as pessoas e empresas com quem você
            movimenta dinheiro (fornecedores, clientes, prestadores). Crie o primeiro abaixo.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 32 }}><SelectAllCheckbox sel={sel} /></th>
                <th>Nome</th>
                <th>Tipo</th>
                <th>Documento</th>
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
                            value={draft.name}
                            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                            style={fieldStyle}
                          />
                        </td>
                        <td>
                          <select
                            value={draft.kind}
                            onChange={(e) =>
                              setDraft({ ...draft, kind: e.target.value as ContactKind })
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
                          <input
                            value={draft.document}
                            onChange={(e) => setDraft({ ...draft, document: e.target.value })}
                            placeholder="CPF/CNPJ"
                            style={{ ...fieldStyle, width: 150 }}
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
                        <td>{KIND_LABELS[c.kind]}</td>
                        <td>{c.document || "—"}</td>
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
        <h2>Novo contato</h2>
        <form onSubmit={createNew} style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <input
            placeholder="Nome"
            value={creating.name}
            onChange={(e) => setCreating({ ...creating, name: e.target.value })}
            required
            style={{ ...fieldStyle, minWidth: 220 }}
          />
          <select
            value={creating.kind}
            onChange={(e) => setCreating({ ...creating, kind: e.target.value as ContactKind })}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
          <input
            placeholder="CPF/CNPJ (opcional)"
            value={creating.document}
            onChange={(e) => setCreating({ ...creating, document: e.target.value })}
            style={{ ...fieldStyle, width: 170 }}
          />
          <input
            placeholder="Observações (opcional)"
            value={creating.notes}
            onChange={(e) => setCreating({ ...creating, notes: e.target.value })}
            style={{ ...fieldStyle, minWidth: 220 }}
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
