"use client";

// Painel "Abater lançamentos" de um título (Contas a pagar / a receber):
// lista os lançamentos que JÁ existem — recebidos/pagos antes de o título ser
// gerado — para marcar quais abatem o título. Eles viram baixas que apontam
// para o lançamento: nenhum lançamento novo é criado e o dinheiro continua
// contado uma vez só. Período, conta e busca ajudam a achar; os sugeridos
// (mesmo cliente/fornecedor, mesma categoria ou o nome do título na
// descrição) aparecem primeiro.

import { useEffect, useMemo, useState } from "react";
import { brl } from "@/lib/br/money";
import { todayBr } from "@/lib/br/date";
import { loadErrorMessage } from "@/lib/errors";
import { defaultLinkPeriod, linkCandidates, linkSummary } from "@/lib/bills/link";
import { listTransactions } from "@/services/firestore";
import { DatePicker } from "@/components/DatePicker";
import type { Account, Bill, Category, Transaction } from "@/types";

const brDate = (iso: string) => iso.split("-").reverse().join("/");

export function LinkExistingPanel({
  bill,
  bills,
  accounts,
  categories,
  ownerId,
  transactions,
  busy,
  onConfirm,
  onCancel,
}: {
  bill: Bill;
  /** Todos os títulos do mesmo tipo (para não oferecer lançamento já abatido). */
  bills: Bill[];
  accounts: Account[];
  categories: Category[];
  ownerId: string;
  /** Lançamentos já carregados pela tela; sem isso o painel carrega sozinho. */
  transactions?: Transaction[];
  busy: boolean;
  onConfirm: (chosen: Transaction[], classify: boolean) => void;
  onCancel: () => void;
}) {
  const isPayable = bill.kind === "payable";
  const period = useMemo(() => defaultLinkPeriod(bill, todayBr()), [bill]);
  const [txs, setTxs] = useState<Transaction[] | null>(transactions ?? null);
  const [loadErr, setLoadErr] = useState("");
  const [from, setFrom] = useState(period.from);
  const [to, setTo] = useState(period.to);
  const [accountId, setAccountId] = useState("");
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const [classify, setClassify] = useState(true);

  useEffect(() => {
    if (transactions) return;
    let alive = true;
    listTransactions(ownerId)
      .then((t) => alive && setTxs(t))
      .catch((err) => alive && setLoadErr(loadErrorMessage(err)));
    return () => {
      alive = false;
    };
  }, [ownerId, transactions]);

  const accountName = useMemo(() => new Map(accounts.map((a) => [a.id!, a.name])), [accounts]);
  const categoryName = useMemo(
    () => new Map(categories.filter((c) => c.id).map((c) => [c.id as string, c.name])),
    [categories],
  );

  const list = useMemo(
    () => (txs ? linkCandidates(bill, txs, bills, { from, to, accountId, query }) : []),
    [txs, bill, bills, from, to, accountId, query],
  );
  const chosen = useMemo(() => (txs ?? []).filter((t) => t.id && sel.has(t.id)), [txs, sel]);
  const sum = linkSummary(bill, chosen);
  const visibleIds = new Set(list.map((c) => c.tx.id!));
  const hidden = chosen.filter((t) => !visibleIds.has(t.id!)).length;
  const allOn = list.length > 0 && list.every((c) => sel.has(c.tx.id!));

  const toggle = (id: string) =>
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSel((prev) => {
      const next = new Set(prev);
      for (const c of list) {
        if (allOn) next.delete(c.tx.id!);
        else next.add(c.tx.id!);
      }
      return next;
    });

  const verb = isPayable ? "pagos" : "recebidos";
  const field: React.CSSProperties = {
    padding: "0.35rem 0.5rem",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--bg)",
    color: "var(--text)",
    font: "inherit",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
      <div>
        <strong>Abater lançamentos já {verb}</strong>
        <span className="muted" style={{ fontSize: "0.82rem" }}>
          {" "}
          — marque o que já {isPayable ? "saiu" : "entrou"} por conta deste título. Cada lançamento vira uma
          baixa do título; nenhum lançamento novo é criado e o dinheiro não é contado duas vezes.
        </span>
      </div>

      <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "flex-end" }}>
        <MiniField label="De">
          <DatePicker value={from} onChange={setFrom} allowEmpty placeholder="Início" ariaLabel="Data inicial" />
        </MiniField>
        <MiniField label="Até">
          <DatePicker value={to} onChange={setTo} allowEmpty placeholder="Sem limite" ariaLabel="Data final" />
        </MiniField>
        <MiniField label="Conta">
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} style={field}>
            <option value="">Todas</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </MiniField>
        <MiniField label="Buscar">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Descrição ou valor"
            style={{ ...field, minWidth: 180 }}
          />
        </MiniField>
      </div>

      {loadErr ? (
        <p className="badge warn" style={{ margin: 0 }}>Falha ao carregar os lançamentos: {loadErr}</p>
      ) : txs === null ? (
        <p className="muted" style={{ margin: 0 }}>Carregando lançamentos…</p>
      ) : list.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          Nenhum lançamento de {isPayable ? "despesa" : "receita"} livre nesse filtro. Amplie o período ou
          limpe a busca.
        </p>
      ) : (
        <div style={{ maxHeight: 340, overflow: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
          <table className="dense">
            <thead>
              <tr>
                <th style={{ width: 28 }}>
                  <input
                    type="checkbox"
                    checked={allOn}
                    onChange={toggleAll}
                    aria-label="Marcar todos os da lista"
                    title="Marcar/desmarcar todos os da lista"
                  />
                </th>
                <th>Data</th>
                <th>Descrição</th>
                <th>Conta</th>
                <th>Categoria</th>
                <th style={{ textAlign: "right" }}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {list.map(({ tx, suggested }) => {
                const on = sel.has(tx.id!);
                return (
                  <tr
                    key={tx.id}
                    onClick={() => toggle(tx.id!)}
                    style={{ cursor: "pointer", background: on ? "var(--surface-2)" : undefined }}
                  >
                    <td>
                      <input
                        type="checkbox"
                        checked={on}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggle(tx.id!)}
                        aria-label={`Abater ${tx.description}`}
                      />
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{brDate(tx.date)}</td>
                    <td>
                      {tx.description}
                      {suggested && (
                        <span
                          className="chip"
                          style={{ marginLeft: 6, fontSize: "0.62rem", padding: "0.05rem 0.4rem", whiteSpace: "nowrap" }}
                        >
                          sugerido
                        </span>
                      )}
                    </td>
                    <td>{accountName.get(tx.accountId) ?? "—"}</td>
                    <td>{tx.categoryId ? (categoryName.get(tx.categoryId) ?? "—") : "—"}</td>
                    <td
                      style={{
                        textAlign: "right",
                        whiteSpace: "nowrap",
                        fontWeight: 600,
                        color: isPayable ? "var(--err)" : "var(--ok)",
                      }}
                    >
                      {brl(tx.amount)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "center", fontSize: "0.88rem" }}>
        <span>
          Selecionados: <strong>{sum.count}</strong> · <strong>{brl(sum.total)}</strong>
          {hidden > 0 && <span className="muted"> ({hidden} fora do filtro atual)</span>}
        </span>
        <span>
          Saldo do título: {brl(sum.remainingBefore)} → <strong>{brl(sum.remainingAfter)}</strong>
          {sum.count > 0 && sum.remainingAfter === 0 && sum.excess === 0 && (
            <span style={{ color: "var(--ok)" }}> (quitado)</span>
          )}
        </span>
        {sum.excess > 0 && (
          <span style={{ color: "var(--warn)" }}>
            Passa {brl(sum.excess)} do saldo: o título fica quitado e o excedente não vira crédito.
          </span>
        )}
      </div>

      <label style={{ display: "flex", gap: "0.45rem", alignItems: "center", fontSize: "0.85rem" }}>
        <input type="checkbox" checked={classify} onChange={(e) => setClassify(e.target.checked)} />
        Lançamentos sem categoria, centro de custo ou {isPayable ? "fornecedor" : "cliente"} recebem os do título
      </label>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button
          className="btn-primary"
          disabled={busy || sum.count === 0}
          onClick={() => onConfirm(chosen, classify)}
        >
          {busy ? "Abatendo…" : `Abater ${sum.count} lançamento(s)`}
        </button>
        <button style={{ background: "var(--border)" }} disabled={busy} onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

function MiniField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
      <span className="muted" style={{ fontSize: "0.75rem" }}>{label}</span>
      {children}
    </div>
  );
}
