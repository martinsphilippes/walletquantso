"use client";

// WalletQuantso — tela de Clientes do negócio de entregas.
//
// Cada cliente guarda suas regras de cobrança (diária por turno, tabela de
// bairros, percentual do faturamento). A partir delas, o painel "Gerar título"
// calcula o valor do período e cria, com um clique, um título em Contas a
// receber já classificado com os vínculos padrão do cliente.

import { useCallback, useEffect, useMemo, useState } from "react";
import { LoginGate } from "@/components/LoginGate";
import { useAuth } from "@/services/auth-context";
import {
  listAccounts,
  listCategories,
  listContacts,
  listCostCenters,
} from "@/services/firestore";
import { listClients, createClient, updateClient, removeClient } from "@/services/clients";
import { createBill } from "@/services/bills";
import { computeCharge, chargeDescription, type ChargeInput } from "@/lib/clients/billing";
import { parseBrCurrency } from "@/lib/br/parse";
import { DateParts } from "@/components/DateParts";
import { todayBr } from "@/lib/br/date";
import type { Account, Category, Client, Contact, CostCenter, DeliveryZone } from "@/types";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const rid = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export default function ClientesPage() {
  return (
    <>
      <h1>Clientes</h1>
      <LoginGate>
        <Clientes />
      </LoginGate>
    </>
  );
}

interface ZoneDraft {
  id: string;
  name: string;
  price: string;
}

interface Draft {
  name: string;
  dailyRate: string;
  revenuePercent: string;
  zones: ZoneDraft[];
  contactId: string;
  accountId: string;
  categoryId: string;
  costCenterId: string;
}

const emptyDraft = (): Draft => ({
  name: "",
  dailyRate: "",
  revenuePercent: "",
  zones: [],
  contactId: "",
  accountId: "",
  categoryId: "",
  costCenterId: "",
});

function draftFromClient(c: Client): Draft {
  return {
    name: c.name,
    dailyRate: c.dailyRate != null ? String(c.dailyRate).replace(".", ",") : "",
    revenuePercent: c.revenuePercent != null ? String(c.revenuePercent).replace(".", ",") : "",
    zones: (c.zones ?? []).map((z) => ({
      id: z.id,
      name: z.name,
      price: String(z.price).replace(".", ","),
    })),
    contactId: c.contactId ?? "",
    accountId: c.accountId ?? "",
    categoryId: c.categoryId ?? "",
    costCenterId: c.costCenterId ?? "",
  };
}

function Clientes() {
  const { user } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Formulário de cliente (novo ou edição).
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null);

  // Painel "Gerar título" (um cliente por vez).
  const [chargingId, setChargingId] = useState<string | null>(null);
  const [morning, setMorning] = useState("");
  const [afternoon, setAfternoon] = useState("");
  const [deliveries, setDeliveries] = useState<Record<string, string>>({});
  const [revenue, setRevenue] = useState("");
  const [dueDate, setDueDate] = useState(todayBr());
  const [chargeMsg, setChargeMsg] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    setError("");
    setLoading(true);
    try {
      const [cl, ct, ac, cat, cc] = await Promise.all([
        listClients(user.uid),
        listContacts(user.uid),
        listAccounts(user.uid),
        listCategories(user.uid),
        listCostCenters(user.uid),
      ]);
      setClients(cl);
      setContacts(ct.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")));
      setAccounts(ac);
      setCategories(cat.filter((c) => c.kind === "income"));
      setCostCenters(cc.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")));
    } catch (err) {
      setError(`Falha ao carregar: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const mainCategories = useMemo(() => categories.filter((c) => !c.parentId), [categories]);

  function startCreate() {
    setEditingId(null);
    setDraft(emptyDraft());
    setFormOpen(true);
  }

  function startEdit(c: Client) {
    setEditingId(c.id!);
    setDraft(draftFromClient(c));
    setFormOpen(true);
  }

  function draftToClient(): Omit<Client, "id"> | null {
    if (!user) return null;
    if (!draft.name.trim()) {
      setError("Informe o nome do cliente.");
      return null;
    }
    const dailyRate = draft.dailyRate.trim() ? parseBrCurrency(draft.dailyRate) : null;
    const revenuePercent = draft.revenuePercent.trim()
      ? parseBrCurrency(draft.revenuePercent)
      : null;
    const zones: DeliveryZone[] = [];
    for (const z of draft.zones) {
      if (!z.name.trim()) continue;
      const price = parseBrCurrency(z.price);
      if (price == null || price <= 0) {
        setError(`Informe o preço do bairro "${z.name}".`);
        return null;
      }
      zones.push({ id: z.id, name: z.name.trim(), price });
    }
    if ((dailyRate ?? 0) <= 0 && (revenuePercent ?? 0) <= 0 && zones.length === 0) {
      setError("Defina ao menos uma regra: diária, bairros de entrega ou percentual.");
      return null;
    }
    return {
      ownerId: user.uid,
      name: draft.name.trim(),
      dailyRate: dailyRate ?? null,
      revenuePercent: revenuePercent ?? null,
      zones,
      contactId: draft.contactId || null,
      accountId: draft.accountId || null,
      categoryId: draft.categoryId || null,
      costCenterId: draft.costCenterId || null,
      createdAt: Date.now(),
    };
  }

  async function saveClient(e: React.FormEvent) {
    e.preventDefault();
    const data = draftToClient();
    if (!data) return;
    setBusy(true);
    setError("");
    try {
      if (editingId) {
        const { createdAt: _ignored, ...patch } = data;
        await updateClient(editingId, patch);
      } else {
        await createClient(data);
      }
      setFormOpen(false);
      setEditingId(null);
      setDraft(emptyDraft());
      await load();
    } catch (err) {
      setError(`Falha ao salvar: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function doDelete(c: Client) {
    setBusy(true);
    setError("");
    try {
      await removeClient(c.id!);
      setConfirmDelId(null);
      await load();
    } catch (err) {
      setError(`Falha ao excluir: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  function openCharge(c: Client) {
    setChargingId(c.id!);
    setMorning("");
    setAfternoon("");
    setDeliveries({});
    setRevenue("");
    setDueDate(todayBr());
    setChargeMsg("");
  }

  function chargeInput(): ChargeInput {
    const dels: Record<string, number> = {};
    for (const [k, v] of Object.entries(deliveries)) {
      const n = parseInt(v, 10);
      if (Number.isFinite(n) && n > 0) dels[k] = n;
    }
    return {
      morningShifts: parseInt(morning, 10) || 0,
      afternoonShifts: parseInt(afternoon, 10) || 0,
      deliveries: dels,
      revenue: revenue.trim() ? parseBrCurrency(revenue) : null,
    };
  }

  async function generateBill(c: Client) {
    if (!user) return;
    const charge = computeCharge(c, chargeInput());
    if (charge.total <= 0) {
      setChargeMsg("Informe as quantidades (ou o faturamento) para gerar o título.");
      return;
    }
    setBusy(true);
    setChargeMsg("");
    setError("");
    try {
      await createBill({
        ownerId: user.uid,
        kind: "receivable",
        description: chargeDescription(c, charge),
        amount: charge.total,
        dueDate,
        competenceDate: dueDate,
        documentNumber: null,
        contactId: c.contactId ?? null,
        categoryId: c.categoryId ?? null,
        costCenterId: c.costCenterId ?? null,
        accountId: c.accountId ?? null,
        notes: null,
        payments: [],
        createdAt: Date.now(),
      });
      setChargeMsg(
        `✅ Título de ${brl(charge.total)} criado em Contas a receber (venc. ${dueDate
          .split("-")
          .reverse()
          .join("/")}).`,
      );
      setMorning("");
      setAfternoon("");
      setDeliveries({});
      setRevenue("");
    } catch (err) {
      setChargeMsg(`❌ Falha ao gerar: ${(err as Error).message}`);
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

      <p>
        <button onClick={startCreate}>+ Novo cliente</button>
      </p>

      {formOpen && (
        <div className="panel">
          <h2>{editingId ? "Editar cliente" : "Novo cliente"}</h2>
          <form onSubmit={saveClient}>
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              <Field label="Nome do cliente">
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  required
                  style={{ ...fieldStyle, minWidth: 220 }}
                />
              </Field>
              <Field label="Valor da diária (R$) — opcional">
                <input
                  placeholder="Ex.: 90,00"
                  value={draft.dailyRate}
                  onChange={(e) => setDraft({ ...draft, dailyRate: e.target.value })}
                  inputMode="decimal"
                  style={{ ...fieldStyle, width: 120, textAlign: "right" }}
                />
              </Field>
              <Field label="% do faturamento — opcional">
                <input
                  placeholder="Ex.: 12"
                  value={draft.revenuePercent}
                  onChange={(e) => setDraft({ ...draft, revenuePercent: e.target.value })}
                  inputMode="decimal"
                  style={{ ...fieldStyle, width: 100, textAlign: "right" }}
                />
              </Field>
            </div>

            <h3 style={{ marginBottom: "0.25rem" }}>Tabela de bairros (entregas) — opcional</h3>
            <p className="muted" style={{ marginTop: 0, fontSize: "0.82rem" }}>
              Cada bairro tem um preço de entrega pré-definido.
            </p>
            {draft.zones.map((z, i) => (
              <div
                key={z.id}
                style={{ display: "flex", gap: "0.5rem", marginBottom: "0.4rem", alignItems: "center" }}
              >
                <input
                  placeholder="Bairro"
                  value={z.name}
                  onChange={(e) => {
                    const zones = [...draft.zones];
                    zones[i] = { ...z, name: e.target.value };
                    setDraft({ ...draft, zones });
                  }}
                  style={{ ...fieldStyle, minWidth: 180 }}
                />
                <input
                  placeholder="Preço (R$)"
                  value={z.price}
                  onChange={(e) => {
                    const zones = [...draft.zones];
                    zones[i] = { ...z, price: e.target.value };
                    setDraft({ ...draft, zones });
                  }}
                  inputMode="decimal"
                  style={{ ...fieldStyle, width: 110, textAlign: "right" }}
                />
                <button
                  type="button"
                  style={{ background: "var(--err)", padding: "0.3rem 0.6rem" }}
                  onClick={() =>
                    setDraft({ ...draft, zones: draft.zones.filter((x) => x.id !== z.id) })
                  }
                >
                  Remover
                </button>
              </div>
            ))}
            <p>
              <button
                type="button"
                style={{ background: "var(--border)" }}
                onClick={() =>
                  setDraft({
                    ...draft,
                    zones: [...draft.zones, { id: rid(), name: "", price: "" }],
                  })
                }
              >
                + Adicionar bairro
              </button>
            </p>

            <h3 style={{ marginBottom: "0.25rem" }}>Vínculos do título gerado (opcional)</h3>
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              <Field label="Cliente (contato)">
                <select
                  value={draft.contactId}
                  onChange={(e) => setDraft({ ...draft, contactId: e.target.value })}
                >
                  <option value="">—</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Conta">
                <select
                  value={draft.accountId}
                  onChange={(e) => setDraft({ ...draft, accountId: e.target.value })}
                >
                  <option value="">—</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Categoria (receita)">
                <select
                  value={draft.categoryId}
                  onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}
                >
                  <option value="">—</option>
                  {mainCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Centro de custo">
                <select
                  value={draft.costCenterId}
                  onChange={(e) => setDraft({ ...draft, costCenterId: e.target.value })}
                >
                  <option value="">—</option>
                  {costCenters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <p style={{ marginTop: "0.75rem" }}>
              <button type="submit" disabled={busy}>
                {busy ? "Salvando…" : editingId ? "Salvar cliente" : "Adicionar cliente"}
              </button>{" "}
              <button
                type="button"
                style={{ background: "var(--border)" }}
                onClick={() => {
                  setFormOpen(false);
                  setEditingId(null);
                }}
              >
                Cancelar
              </button>
            </p>
          </form>
        </div>
      )}

      {clients.length === 0 && !formOpen ? (
        <div className="panel">
          <p className="muted">
            Nenhum cliente ainda. Toque em “+ Novo cliente” e defina as regras dele: valor da
            diária, tabela de bairros e/ou percentual do faturamento.
          </p>
        </div>
      ) : (
        clients.map((c) => {
          const charging = chargingId === c.id;
          const charge = charging ? computeCharge(c, chargeInput()) : null;
          return (
            <div className="panel" key={c.id}>
              <div
                style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}
              >
                <h2 style={{ margin: 0 }}>{c.name}</h2>
                {(c.dailyRate ?? 0) > 0 && (
                  <span className="badge" style={{ background: "var(--border)" }}>
                    Diária {brl(c.dailyRate!)}
                  </span>
                )}
                {(c.zones?.length ?? 0) > 0 && (
                  <span className="badge" style={{ background: "var(--border)" }}>
                    {c.zones!.length} bairro(s)
                  </span>
                )}
                {(c.revenuePercent ?? 0) > 0 && (
                  <span className="badge" style={{ background: "var(--border)" }}>
                    {String(c.revenuePercent).replace(".", ",")}% do faturamento
                  </span>
                )}
                <span style={{ flex: 1 }} />
                <button className="btn-primary" onClick={() => (charging ? setChargingId(null) : openCharge(c))}>
                  {charging ? "Fechar" : "Gerar título"}
                </button>
                <button style={{ background: "var(--border)" }} onClick={() => startEdit(c)}>
                  Editar
                </button>
                {confirmDelId === c.id ? (
                  <>
                    <span className="muted">Excluir "{c.name}"?</span>
                    <button
                      style={{ background: "var(--err)" }}
                      disabled={busy}
                      onClick={() => doDelete(c)}
                    >
                      Confirmar
                    </button>
                    <button
                      style={{ background: "var(--border)" }}
                      onClick={() => setConfirmDelId(null)}
                    >
                      Cancelar
                    </button>
                  </>
                ) : (
                  <button
                    style={{ background: "var(--err)" }}
                    onClick={() => setConfirmDelId(c.id!)}
                  >
                    Excluir
                  </button>
                )}
              </div>

              {charging && (
                <div style={{ marginTop: "0.75rem", borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
                  <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                    {(c.dailyRate ?? 0) > 0 && (
                      <>
                        <Field label={`Diárias manhã (${brl(c.dailyRate!)} cada)`}>
                          <input
                            value={morning}
                            onChange={(e) => setMorning(e.target.value)}
                            inputMode="numeric"
                            placeholder="0"
                            style={{ ...fieldStyle, width: 90, textAlign: "right" }}
                          />
                        </Field>
                        <Field label="Diárias tarde">
                          <input
                            value={afternoon}
                            onChange={(e) => setAfternoon(e.target.value)}
                            inputMode="numeric"
                            placeholder="0"
                            style={{ ...fieldStyle, width: 90, textAlign: "right" }}
                          />
                        </Field>
                      </>
                    )}
                    {(c.revenuePercent ?? 0) > 0 && (
                      <Field label={`Faturamento entregue (R$) — cobra ${String(c.revenuePercent).replace(".", ",")}%`}>
                        <input
                          value={revenue}
                          onChange={(e) => setRevenue(e.target.value)}
                          inputMode="decimal"
                          placeholder="0,00"
                          style={{ ...fieldStyle, width: 140, textAlign: "right" }}
                        />
                      </Field>
                    )}
                    <Field label="Vencimento">
                      <DateParts value={dueDate} onChange={setDueDate} />
                    </Field>
                  </div>

                  {(c.zones?.length ?? 0) > 0 && (
                    <div style={{ overflowX: "auto", marginTop: "0.5rem" }}>
                      <table>
                        <thead>
                          <tr>
                            <th>Bairro</th>
                            <th style={{ textAlign: "right" }}>Preço</th>
                            <th style={{ textAlign: "right" }}>Entregas</th>
                            <th style={{ textAlign: "right" }}>Subtotal</th>
                          </tr>
                        </thead>
                        <tbody>
                          {c.zones!.map((z) => {
                            const qty = parseInt(deliveries[z.id] ?? "", 10) || 0;
                            return (
                              <tr key={z.id}>
                                <td>{z.name}</td>
                                <td style={{ textAlign: "right" }}>{brl(z.price)}</td>
                                <td style={{ textAlign: "right" }}>
                                  <input
                                    value={deliveries[z.id] ?? ""}
                                    onChange={(e) =>
                                      setDeliveries({ ...deliveries, [z.id]: e.target.value })
                                    }
                                    inputMode="numeric"
                                    placeholder="0"
                                    style={{ ...fieldStyle, width: 70, textAlign: "right" }}
                                  />
                                </td>
                                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                                  {brl(qty * z.price)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div
                    style={{
                      display: "flex",
                      gap: "0.75rem",
                      alignItems: "center",
                      flexWrap: "wrap",
                      marginTop: "0.75rem",
                    }}
                  >
                    <strong style={{ fontSize: "1.1rem" }}>
                      Total: <span style={{ color: "var(--ok)" }}>{brl(charge?.total ?? 0)}</span>
                    </strong>
                    {charge && charge.lines.length > 0 && (
                      <span className="muted" style={{ fontSize: "0.85rem" }}>
                        {charge.lines.join(" · ")}
                      </span>
                    )}
                    <span style={{ flex: 1 }} />
                    <button disabled={busy || (charge?.total ?? 0) <= 0} onClick={() => generateBill(c)}>
                      {busy ? "Gerando…" : "Gerar título a receber"}
                    </button>
                  </div>
                  {chargeMsg && (
                    <p style={{ marginTop: "0.5rem", marginBottom: 0 }}>
                      <span className={`badge ${chargeMsg.startsWith("✅") ? "ok" : "warn"}`}>
                        {chargeMsg}
                      </span>
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
      <span className="muted" style={{ fontSize: "0.8rem" }}>{label}</span>
      {children}
    </label>
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
