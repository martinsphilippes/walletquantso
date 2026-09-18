import { describe, it, expect } from "vitest";
import { buildPayablesMessages, groupPayablesByAccount, escapeHtml } from "./payables-telegram";
import type { Account, Bill } from "@/types";

const acc = (id: string, name: string): Account => ({
  id,
  ownerId: "u",
  name,
  type: "checking",
  initialBalance: 0,
  currency: "BRL",
  archived: false,
  createdAt: 0,
});

const bill = (p: Partial<Bill>): Bill => ({
  ownerId: "u",
  kind: "payable",
  description: "x",
  amount: 100,
  dueDate: "2026-09-20",
  payments: [],
  createdAt: 0,
  ...p,
});

const accounts = [acc("c", "Cora"), acc("b", "Bradesco")];

describe("groupPayablesByAccount", () => {
  it("agrupa por conta, ordena por vencimento e separa atrasados", () => {
    const bills = [
      bill({ id: "1", accountId: "c", dueDate: "2026-09-25", amount: 50 }),
      bill({ id: "2", accountId: "c", dueDate: "2026-09-10", amount: 30 }), // atrasado
      bill({ id: "3", accountId: "b", dueDate: "2026-09-18", amount: 20 }), // hoje
      bill({ id: "4", accountId: null, dueDate: "2026-09-30", amount: 10 }),
      bill({ id: "5", accountId: "c", amount: 100, payments: [{ id: "p", date: "2026-09-01", amount: 100 }] }), // pago
      bill({ id: "6", kind: "receivable", accountId: "c", amount: 999 }), // a receber não entra
    ];
    const g = groupPayablesByAccount(bills, accounts, "2026-09-18");
    expect(g.map((x) => x.accountName)).toEqual(["Bradesco", "Cora", "Sem conta definida"]);
    const cora = g[1];
    expect(cora.bills.map((b) => b.dueDate)).toEqual(["2026-09-10", "2026-09-25"]);
    expect(cora.total).toBe(80);
    expect(cora.overdue).toBe(30);
    expect(g[0].bills[0].status).toBe("today");
  });

  it("baixa parcial conta só o restante", () => {
    const g = groupPayablesByAccount(
      [bill({ id: "1", accountId: "c", amount: 100, payments: [{ id: "p", date: "2026-09-01", amount: 40 }] })],
      accounts,
      "2026-09-18",
    );
    expect(g[0].total).toBe(60);
  });
});

describe("buildPayablesMessages", () => {
  it("monta cabeçalho com total e blocos por conta", () => {
    const bills = [
      bill({ id: "1", accountId: "c", dueDate: "2026-09-10", amount: 30, description: "Luz <Enel>" }),
      bill({ id: "2", accountId: "b", dueDate: "2026-09-18", amount: 20, description: "Água" }),
    ];
    const msgs = buildPayablesMessages(bills, accounts, "2026-09-18");
    expect(msgs).toHaveLength(1);
    // A formatação pt-BR usa espaço inquebrável depois de "R$".
    const m = msgs[0].replace(/\u00a0/g, " ");
    expect(m).toContain("Contas a pagar — 18/09/2026");
    expect(m).toContain("2 título(s) em aberto · total <b>R$ 50,00</b>");
    expect(m).toContain("🔴 Atrasado: <b>R$ 30,00</b>");
    expect(m).toContain("<b>🏦 Bradesco</b> — 1 título(s) · <b>R$ 20,00</b>");
    expect(m).toContain("🟡 18/09 · Água · R$ 20,00");
    expect(m).toContain("🔴 10/09 · Luz &lt;Enel&gt; · R$ 30,00");
  });

  it("sem títulos: mensagem única de lista vazia", () => {
    const msgs = buildPayablesMessages([], accounts, "2026-09-18");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain("Nenhum título em aberto");
  });

  it("divide em várias mensagens quando passa do limite do Telegram", () => {
    const bills = Array.from({ length: 300 }, (_, i) =>
      bill({ id: String(i), accountId: "c", dueDate: "2026-10-01", description: `Título número ${i} com descrição longa` }),
    );
    const msgs = buildPayablesMessages(bills, accounts, "2026-09-18");
    expect(msgs.length).toBeGreaterThan(1);
    for (const m of msgs) expect(m.length).toBeLessThanOrEqual(4096);
    expect(msgs.join("\n")).toContain("(continuação)");
  });

  it("escapeHtml protege & < >", () => {
    expect(escapeHtml("a & b <c>")).toBe("a &amp; b &lt;c&gt;");
  });
});
