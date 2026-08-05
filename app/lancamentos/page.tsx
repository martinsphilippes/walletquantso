"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LoginGate } from "@/components/LoginGate";
import { useAuth } from "@/services/auth-context";
import {
  listAccounts,
  listCategories,
  listContacts,
  listCostCenters,
  listTransactions,
} from "@/services/firestore";
import {
  createTransaction,
  updateTransaction,
  removeTransaction,
  bulkPatchTransactions,
  type TransactionInput,
} from "@/services/transactions";
import { TransactionForm } from "@/components/TransactionForm";
import { useColumnFilters, FilterRow, type ColFilterDef } from "@/components/ColumnFilter";
import { useBulkSelect, SelectAllCheckbox, RowCheckbox, BulkBar } from "@/components/BulkSelect";
import { FilterField } from "@/components/FilterField";
import { todayBr, daysAgoBr, monthRangeBr } from "@/lib/br/date";
import { loadPeriod, savePreset, saveCustomPeriod } from "@/lib/period-presets";
import { effectiveCostCenterId } from "@/lib/categories/tree";
import { transactionsToCsv } from "@/lib/export/csv";
import { downloadText } from "@/lib/export/download";
import {
  filterTransactions,
  summarize,
  type DashboardFilters,
} from "@/lib/dashboard/filter";
import type {
  Account,
  Category,
  Contact,
  CostCenter,
  Transaction,
  TransactionType,
} from "@/types";

const TYPE_LABELS: Record<TransactionType, string> = {
  income: "Receita",
  expense: "Despesa",
  transfer: "Transferência",
};

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function LancamentosPage() {
  return (
    <>
      <h1>Lançamentos</h1>
      <LoginGate>
        <Lancamentos />
      </LoginGate>
    </>
  );
}

function Lancamentos() {
  const { user } = useAuth();
  const [txs, setTxs] = useState<Transaction[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<DashboardFilters>({});

  // A última escolha de período fica gravada e volta aplicada na próxima
  // visita ("Este mês" reabre no mês corrente; datas manuais voltam exatas).
  useEffect(() => {
    const p = loadPeriod("wq.lanc.period");
    if (p && (p.from || p.to)) {
      setFilters((prev) => ({ ...prev, from: p.from || undefined, to: p.to || undefined }));
    }
  }, []);
  const [form, setForm] = useState<
    | { mode: "new" }
    | { mode: "edit"; tx: Transaction }
    | { mode: "clone"; tx: Transaction }
    | null
  >(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setError("");
    try {
      const [t, a, c, cc, ct] = await Promise.all([
        listTransactions(user.uid),
        listAccounts(user.uid),
        listCategories(user.uid),
        listCostCenters(user.uid),
        listContacts(user.uid),
      ]);
      setTxs(t);
      setAccounts(a);
      setCategories(c);
      cc.sort((x, y) => x.name.localeCompare(y.name, "pt-BR"));
      ct.sort((x, y) => x.name.localeCompare(y.name, "pt-BR"));
      setCostCenters(cc);
      setContacts(ct);
    } catch (err) {
      setError(`Falha ao carregar: ${(err as Error).message}`);
      setTxs([]);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const accountName = useMemo(
    () => new Map(accounts.map((x) => [x.id!, x.name])),
    [accounts],
  );
  const categoryName = useMemo(
    () => new Map(categories.map((x) => [x.id!, x.name])),
    [categories],
  );
  const costCenterName = useMemo(
    () => new Map(costCenters.map((x) => [x.id!, x.name])),
    [costCenters],
  );
  const contactName = useMemo(
    () => new Map(contacts.map((x) => [x.id!, x.name])),
    [contacts],
  );
  const catById = useMemo(
    () => new Map(categories.filter((c) => c.id).map((c) => [c.id as string, c])),
    [categories],
  );
  // Hierarquia: categoria principal e subcategoria são campos separados.
  const mainCategories = useMemo(() => categories.filter((c) => !c.parentId), [categories]);
  const subsOf = (mainId: string) =>
    mainId ? categories.filter((c) => c.parentId === mainId) : [];
  // Com Tipo ativo, só categorias daquele tipo; com Centro ativo, só as dele.
  const filterMains = mainCategories.filter(
    (c) =>
      (!filters.type || c.kind === filters.type) &&
      (!filters.costCenterId || (c.costCenterId ?? "") === filters.costCenterId),
  );

  // Categoria selecionada no filtro: derivada dos filtros ativos (o exato em
  // `categoryId` quando é uma sub; o grupo inteiro em `categoryIds` quando é
  // uma principal — inclui as subs dela).
  const fCatMain = filters.categoryId
    ? (catById.get(filters.categoryId)?.parentId ?? "")
    : (filters.categoryIds?.[0] ?? "");
  const pickFilterCategory = (id: string) => {
    if (!id) {
      set({ categoryId: undefined, categoryIds: undefined });
      return;
    }
    const group = [id, ...categories.filter((c) => c.parentId === id).map((c) => c.id!)];
    set({ categoryId: undefined, categoryIds: group });
  };

  const filtered = useMemo(
    () => (txs ? filterTransactions(txs, filters) : []),
    [txs, filters],
  );
  const summary = useMemo(() => summarize(filtered), [filtered]);

  const set = (patch: Partial<DashboardFilters>) =>
    setFilters((prev) => ({ ...prev, ...patch }));

  const nameOfAccount = (id?: string | null) => (id ? (accountName.get(id) ?? id) : "—");
  const nameOf = (m: Map<string, string>, id?: string | null) =>
    id ? (m.get(id) ?? "—") : "—";

  // Inline per-column filters, layered on top of the filter panel above.
  const colDefs: ColFilterDef<Transaction>[] = [
    { key: "select", type: "none" },
    { key: "date", value: (t) => t.date.split("-").reverse().join("/") },
    { key: "description", value: (t) => t.description },
    { key: "type", type: "select", value: (t) => TYPE_LABELS[t.type] },
    // Categoria mostra sempre a principal; a subcategoria tem coluna própria.
    {
      key: "category",
      type: "select",
      value: (t) => {
        const c = t.categoryId ? catById.get(t.categoryId) : undefined;
        return c ? (c.parentId ? (categoryName.get(c.parentId) ?? "—") : c.name) : "—";
      },
    },
    {
      key: "subcategory",
      type: "select",
      value: (t) => {
        const c = t.categoryId ? catById.get(t.categoryId) : undefined;
        return c?.parentId ? c.name : "";
      },
    },
    { key: "center", type: "select", value: (t) => nameOf(costCenterName, t.costCenterId) },
    { key: "contact", type: "select", value: (t) => nameOf(contactName, t.contactId) },
    {
      key: "account",
      type: "select",
      value: (t) =>
        t.type === "transfer"
          ? `${nameOfAccount(t.accountId)} → ${nameOfAccount(t.transferAccountId)}`
          : nameOfAccount(t.accountId),
    },
    { key: "amount", value: (t) => brl(t.amount), align: "right" },
    { key: "actions", type: "none" },
  ];
  const cf = useColumnFilters(filtered, colDefs);
  const sel = useBulkSelect(cf.filtered, (t) => t.id);

  async function handleBulkDelete() {
    if (!user || sel.count === 0) return;
    setError("");
    try {
      for (const id of sel.selectedIds) await removeTransaction(user.uid, id);
      sel.clear();
      await load();
    } catch (err) {
      setError(`Falha ao excluir: ${(err as Error).message}`);
    }
  }

  // ── Edição em massa (categoria + centro juntos) — inline na barra ────────
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkCat, setBulkCat] = useState("");
  const [bulkSub, setBulkSub] = useState("");
  const [bulkCenter, setBulkCenter] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState("");

  // Só oferece categorias dos tipos presentes na seleção (receita/despesa).
  const bulkKinds = useMemo(() => {
    const ids = new Set(sel.selectedIds);
    const s = new Set<TransactionType>();
    for (const t of txs ?? []) if (t.id && ids.has(t.id)) s.add(t.type);
    return s;
  }, [txs, sel.selectedIds]);
  const bulkMains = mainCategories.filter(
    (c) => bulkKinds.size === 0 || bulkKinds.has(c.kind),
  );

  async function applyBulkEdit() {
    if (!user || sel.count === 0) return;
    if (!bulkCat && !bulkCenter) {
      setBulkMsg("Escolha a categoria e/ou o centro de custo a aplicar.");
      return;
    }
    const ids = sel.selectedIds;
    const byId = new Map((txs ?? []).map((t) => [t.id!, t]));

    // Grava a subcategoria quando escolhida; senão a categoria principal.
    // Categoria tem tipo (receita/despesa): aplica só onde o tipo combina.
    const chosenCat = bulkSub || bulkCat;
    const catValue = chosenCat === "__clear__" ? null : chosenCat || undefined;
    let catIds = ids;
    let skipped = 0;
    if (bulkCat && catValue) {
      const cat = categories.find((c) => c.id === catValue);
      if (cat) {
        catIds = ids.filter((id) => byId.get(id)?.type === cat.kind);
        skipped = ids.length - catIds.length;
      }
    }
    const centerValue = bulkCenter === "__clear__" ? null : bulkCenter || undefined;

    if (!bulkCenter && bulkCat && catIds.length === 0) {
      setBulkMsg("Nenhum dos selecionados é compatível com essa categoria (tipo diferente).");
      return;
    }

    setBulkBusy(true);
    setBulkMsg("");
    setError("");
    try {
      if (bulkCenter) {
        await bulkPatchTransactions(user.uid, ids, { costCenterId: centerValue ?? null });
      }
      if (bulkCat && catIds.length > 0) {
        await bulkPatchTransactions(user.uid, catIds, { categoryId: catValue ?? null });
      }
      const updated = bulkCenter ? ids.length : catIds.length;
      setBulkMsg(
        `✅ ${updated} lançamento(s) atualizado(s).` +
          (skipped > 0 ? ` Categoria não aplicada em ${skipped} por tipo incompatível.` : ""),
      );
      sel.clear();
      setBulkOpen(false);
      setBulkCat("");
      setBulkSub("");
      setBulkCenter("");
      await load();
    } catch (err) {
      setBulkMsg(`❌ Falha ao aplicar: ${(err as Error).message}`);
    } finally {
      setBulkBusy(false);
    }
  }

  function exportCsv() {
    const csv = transactionsToCsv(cf.filtered, {
      account: (id) => (id ? (accountName.get(id) ?? id) : ""),
      category: (id) => (id ? (categoryName.get(id) ?? "") : ""),
      costCenter: (id) => (id ? (costCenterName.get(id) ?? "") : ""),
      contact: (id) => (id ? (contactName.get(id) ?? "") : ""),
    });
    downloadText("walletquantso-lancamentos.csv", csv);
  }

  async function handleSubmit(input: TransactionInput) {
    if (!user) return;
    setSaving(true);
    setError("");
    try {
      if (form?.mode === "edit") {
        await updateTransaction(user.uid, form.tx.id!, input);
        setForm(null);
      } else if (form?.mode === "clone") {
        // Clone: create a brand-new lançamento from the copied data and close.
        await createTransaction(user.uid, input);
        setForm(null);
      } else {
        // Quick-entry: keep the form open so several lançamentos can be added
        // in a row (the form itself keeps the selected fields fixed).
        await createTransaction(user.uid, input);
      }
      await load();
    } catch (err) {
      setError(`Falha ao salvar: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(tx: Transaction) {
    if (!user || !tx.id) return;
    if (!confirm(`Excluir o lançamento "${tx.description || tx.date}"?`)) return;
    setError("");
    try {
      await removeTransaction(user.uid, tx.id);
      await load();
    } catch (err) {
      setError(`Falha ao excluir: ${(err as Error).message}`);
    }
  }

  const txToInput = (t: Transaction): Partial<TransactionInput> => ({
    date: t.date,
    amount: t.amount,
    type: t.type,
    description: t.description,
    accountId: t.accountId,
    transferAccountId: t.transferAccountId,
    categoryId: t.categoryId,
    costCenterId: t.costCenterId,
    contactId: t.contactId,
    notes: t.notes,
  });

  const activeFilterCount = Object.values(filters).filter((v) => v).length;

  if (txs === null) {
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
        <Stat label="Receitas" value={brl(summary.income)} color="var(--ok)" />
        <Stat label="Despesas" value={brl(summary.expense)} color="var(--err)" />
        <Stat
          label="Resultado"
          value={brl(summary.balance)}
          color={summary.balance >= 0 ? "var(--ok)" : "var(--err)"}
        />
        <Stat label="Lançamentos" value={String(summary.count)} />
      </div>

      {form ? (
        <TransactionForm
          accounts={accounts}
          categories={categories}
          costCenters={costCenters}
          contacts={contacts}
          initial={form.mode === "new" ? undefined : txToInput(form.tx)}
          submitLabel={
            form.mode === "edit"
              ? "Salvar alterações"
              : form.mode === "clone"
                ? "Duplicar lançamento"
                : "Adicionar lançamento"
          }
          busy={saving}
          quickEntry={form.mode === "new"}
          onSubmit={handleSubmit}
          onCancel={() => setForm(null)}
        />
      ) : (
        <p>
          <button onClick={() => setForm({ mode: "new" })} disabled={accounts.length === 0}>
            + Novo lançamento
          </button>
          {accounts.length === 0 && (
            <span className="muted"> — crie uma conta primeiro em “Contas financeiras”.</span>
          )}
        </p>
      )}

      <div className="panel">
        <h2>Filtros</h2>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: "0.75rem" }}>
          {(() => {
            const presets: Array<{ label: string; preset: string; from: string; to: string }> = [
              { label: "Este mês", preset: "month0", ...monthRangeBr(0) },
              { label: "Mês passado", preset: "month-1", ...monthRangeBr(-1) },
              { label: "Próximo mês", preset: "month+1", ...monthRangeBr(1) },
              { label: "30 dias", preset: "days30", from: daysAgoBr(30), to: todayBr() },
              { label: "60 dias", preset: "days60", from: daysAgoBr(60), to: todayBr() },
              { label: "90 dias", preset: "days90", from: daysAgoBr(90), to: todayBr() },
            ];
            const chip = (active: boolean): React.CSSProperties => ({
              padding: "0.25rem 0.75rem",
              fontSize: "0.8rem",
              borderRadius: 999,
              border: "1px solid var(--border)",
              background: active ? "var(--accent)" : "transparent",
              color: active ? "var(--accent-ink)" : "var(--muted)",
              cursor: "pointer",
            });
            return (
              <>
                {presets.map((p) => {
                  const active = filters.from === p.from && filters.to === p.to;
                  return (
                    <button
                      key={p.label}
                      type="button"
                      style={chip(active)}
                      onClick={() => {
                        set({ from: p.from, to: p.to });
                        savePreset("wq.lanc.period", p.preset);
                      }}
                    >
                      {p.label}
                    </button>
                  );
                })}
                <button
                  type="button"
                  style={chip(!filters.from && !filters.to)}
                  onClick={() => {
                    set({ from: undefined, to: undefined });
                    savePreset("wq.lanc.period", "all");
                  }}
                >
                  Tudo
                </button>
              </>
            );
          })()}
        </div>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-end" }}>
          <FilterField label="Buscar descrição">
            <input
              placeholder="Ex.: aluguel, pix…"
              value={filters.text ?? ""}
              onChange={(e) => set({ text: e.target.value })}
              style={fieldStyle}
            />
          </FilterField>
          <FilterField label="Tipo">
            <select
              value={filters.type ?? ""}
              onChange={(e) =>
                // Trocar o tipo limpa a categoria (pode não valer para o novo tipo).
                set({
                  type: (e.target.value || "") as TransactionType | "",
                  categoryId: undefined,
                  categoryIds: undefined,
                })
              }
            >
              <option value="">Todos os tipos</option>
              <option value="income">Receita</option>
              <option value="expense">Despesa</option>
              <option value="transfer">Transferência</option>
            </select>
          </FilterField>
          <FilterField label="Conta">
            <select
              value={filters.accountId ?? ""}
              onChange={(e) => set({ accountId: e.target.value || undefined })}
            >
              <option value="">Todas as contas</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </FilterField>
          {costCenters.length > 0 && (
            <FilterField label="Centro de custo">
              <select
                value={filters.costCenterId ?? ""}
                onChange={(e) =>
                  // Trocar o centro limpa a categoria (pode não ser dele).
                  set({
                    costCenterId: e.target.value || undefined,
                    categoryId: undefined,
                    categoryIds: undefined,
                  })
                }
              >
                <option value="">Todos os centros</option>
                {costCenters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </FilterField>
          )}
          <FilterField label="Categoria">
            <select
              value={fCatMain}
              onChange={(e) => pickFilterCategory(e.target.value)}
            >
              <option value="">Todas as categorias</option>
              {filterMains.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </FilterField>
          {fCatMain && subsOf(fCatMain).length > 0 && (
            <FilterField label="Subcategoria">
              <select
                value={filters.categoryId ?? ""}
                onChange={(e) =>
                  e.target.value
                    ? set({ categoryId: e.target.value, categoryIds: undefined })
                    : pickFilterCategory(fCatMain)
                }
              >
                <option value="">Todas</option>
                {subsOf(fCatMain).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </FilterField>
          )}
          {contacts.length > 0 && (
            <FilterField label="Contato">
              <select
                value={filters.contactId ?? ""}
                onChange={(e) => set({ contactId: e.target.value || undefined })}
              >
                <option value="">Todos os contatos</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </FilterField>
          )}
          <FilterField label="Data inicial (de)">
            <input
              type="date"
              value={filters.from ?? ""}
              onChange={(e) => {
                set({ from: e.target.value || undefined });
                saveCustomPeriod("wq.lanc.period", e.target.value, filters.to ?? "");
              }}
              style={fieldStyle}
            />
          </FilterField>
          <FilterField label="Data final (até)">
            <input
              type="date"
              value={filters.to ?? ""}
              onChange={(e) => {
                set({ to: e.target.value || undefined });
                saveCustomPeriod("wq.lanc.period", filters.from ?? "", e.target.value);
              }}
              style={fieldStyle}
            />
          </FilterField>
          {activeFilterCount > 0 && (
            <button
              style={{ background: "var(--border)" }}
              onClick={() => {
                setFilters({});
                savePreset("wq.lanc.period", "all");
              }}
            >
              Limpar
            </button>
          )}
        </div>
      </div>

      <div className="panel">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "0.75rem",
          }}
        >
          <span className="muted">{cf.filtered.length} lançamento(s)</span>
          <button
            style={{ background: "var(--border)" }}
            onClick={exportCsv}
            disabled={cf.filtered.length === 0}
          >
            Exportar CSV
          </button>
        </div>
        <BulkBar
          sel={sel}
          onDelete={handleBulkDelete}
          noun="lançamento"
          extra={
            !bulkOpen ? (
              <>
                <button
                  style={{ background: "var(--border)" }}
                  onClick={() => {
                    setBulkOpen(true);
                    setBulkCat("");
                    setBulkSub("");
                    setBulkCenter("");
                    setBulkMsg("");
                  }}
                >
                  Editar categoria e centro de custo
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
                <span>Centro de custo:</span>
                <select
                  value={bulkCenter}
                  onChange={(e) => {
                    const id = e.target.value;
                    setBulkCenter(id);
                    // Trocar o centro invalida categoria/sub que não são dele.
                    if (id && id !== "__clear__" && bulkCat && bulkCat !== "__clear__") {
                      const cc = effectiveCostCenterId(catById.get(bulkCat), catById);
                      if (cc !== id) {
                        setBulkCat("");
                        setBulkSub("");
                      }
                    }
                  }}
                >
                  <option value="">— não alterar —</option>
                  <option value="__clear__">— limpar (nenhum) —</option>
                  {costCenters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <span>Categoria:</span>
                <select
                  value={bulkCat}
                  onChange={(e) => {
                    const id = e.target.value;
                    setBulkCat(id);
                    setBulkSub("");
                    // Sem centro escolhido, a categoria ainda sugere o dela.
                    if (!bulkCenter) {
                      const cc =
                        id && id !== "__clear__"
                          ? effectiveCostCenterId(catById.get(id), catById)
                          : null;
                      if (cc) setBulkCenter(cc);
                    }
                  }}
                >
                  <option value="">— não alterar —</option>
                  <option value="__clear__">— limpar (nenhuma) —</option>
                  {bulkMains
                    .filter(
                      (c) =>
                        !bulkCenter ||
                        bulkCenter === "__clear__" ||
                        (c.costCenterId ?? "") === bulkCenter,
                    )
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({TYPE_LABELS[c.kind]})
                      </option>
                    ))}
                </select>
                {bulkCat && bulkCat !== "__clear__" && subsOf(bulkCat).length > 0 && (
                  <>
                    <span>Subcategoria:</span>
                    <select value={bulkSub} onChange={(e) => setBulkSub(e.target.value)}>
                      <option value="">— nenhuma —</option>
                      {subsOf(bulkCat).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </>
                )}
                <button disabled={bulkBusy} onClick={applyBulkEdit}>
                  {bulkBusy ? "Aplicando…" : `Aplicar a ${sel.count} selecionado(s)`}
                </button>
                <button
                  style={{ background: "var(--border)" }}
                  disabled={bulkBusy}
                  onClick={() => {
                    setBulkOpen(false);
                    setBulkCat("");
                    setBulkSub("");
                    setBulkCenter("");
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
        {filtered.length === 0 ? (
          <p className="muted">
            {txs.length === 0
              ? "Nenhum lançamento ainda. Crie o primeiro acima ou importe uma planilha."
              : "Nenhum lançamento encontrado com os filtros atuais."}
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 32 }}><SelectAllCheckbox sel={sel} /></th>
                  <th>Data</th>
                  <th>Descrição</th>
                  <th>Tipo</th>
                  <th>Categoria</th>
                  <th>Subcategoria</th>
                  <th>Centro</th>
                  <th>Contato</th>
                  <th>Conta</th>
                  <th style={{ textAlign: "right" }}>Valor</th>
                  <th></th>
                </tr>
                <FilterRow defs={colDefs} cf={cf} />
              </thead>
              <tbody>
                {cf.filtered.map((t) => (
                  <tr key={t.id}>
                    <td><RowCheckbox sel={sel} id={t.id} /></td>
                    <td>{t.date.split("-").reverse().join("/")}</td>
                    <td>{t.description}</td>
                    <td>{TYPE_LABELS[t.type]}</td>
                    <td>
                      {(() => {
                        const c = t.categoryId ? catById.get(t.categoryId) : undefined;
                        if (!c) return "—";
                        return c.parentId ? (categoryName.get(c.parentId) ?? "—") : c.name;
                      })()}
                    </td>
                    <td>
                      {(() => {
                        const c = t.categoryId ? catById.get(t.categoryId) : undefined;
                        return c?.parentId ? c.name : "—";
                      })()}
                    </td>
                    <td>{nameOf(costCenterName, t.costCenterId)}</td>
                    <td>{nameOf(contactName, t.contactId)}</td>
                    <td>
                      {t.type === "transfer"
                        ? `${nameOfAccount(t.accountId)} → ${nameOfAccount(t.transferAccountId)}`
                        : nameOfAccount(t.accountId)}
                    </td>
                    <td
                      style={{
                        textAlign: "right",
                        whiteSpace: "nowrap",
                        color:
                          t.type === "income"
                            ? "var(--ok)"
                            : t.type === "expense"
                              ? "var(--err)"
                              : "var(--text)",
                      }}
                    >
                      {t.type === "expense" ? "-" : t.type === "income" ? "+" : ""}
                      {brl(t.amount)}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button
                        style={{ background: "var(--border)", padding: "0.3rem 0.6rem" }}
                        onClick={() => setForm({ mode: "edit", tx: t })}
                      >
                        Editar
                      </button>{" "}
                      <button
                        style={{ background: "var(--border)", padding: "0.3rem 0.6rem" }}
                        onClick={() => {
                          setForm({ mode: "clone", tx: t });
                          if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                      >
                        Clonar
                      </button>{" "}
                      <button
                        style={{ background: "var(--err)", padding: "0.3rem 0.6rem" }}
                        onClick={() => handleDelete(t)}
                      >
                        Excluir
                      </button>
                    </td>
                  </tr>
                ))}
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

const fieldStyle: React.CSSProperties = {
  padding: "0.35rem 0.5rem",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
  font: "inherit",
};
