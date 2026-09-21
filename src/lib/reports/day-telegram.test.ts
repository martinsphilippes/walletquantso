import { describe, it, expect } from "vitest";
import { buildDayBillsMessages, parseDateArg, parseOneDate, describeRange } from "./day-telegram";
import type { Account, Bill, Contact } from "@/types";

// 21/09/2026 é segunda-feira.
const TODAY = "2026-09-21";

describe("parseOneDate / parseDateArg", () => {
  it("palavras: hoje, amanhã, ontem", () => {
    expect(parseOneDate("", TODAY)).toBe("2026-09-21");
    expect(parseOneDate("hoje", TODAY)).toBe("2026-09-21");
    expect(parseOneDate("Amanhã", TODAY)).toBe("2026-09-22");
    expect(parseOneDate("amanha", TODAY)).toBe("2026-09-22");
    expect(parseOneDate("ontem", TODAY)).toBe("2026-09-20");
  });
  it("dia, dd/mm, dd/mm/aa e dd/mm/aaaa", () => {
    expect(parseOneDate("25", TODAY)).toBe("2026-09-25");
    expect(parseOneDate("5/10", TODAY)).toBe("2026-10-05");
    expect(parseOneDate("05/10/26", TODAY)).toBe("2026-10-05");
    expect(parseOneDate("05.10.2027", TODAY)).toBe("2027-10-05");
    expect(parseOneDate("31/09", TODAY)).toBeNull();
    expect(parseOneDate("xyz", TODAY)).toBeNull();
  });
  it("dia da semana: a próxima ocorrência (hoje conta)", () => {
    expect(parseOneDate("segunda", TODAY)).toBe("2026-09-21");
    expect(parseOneDate("sexta", TODAY)).toBe("2026-09-25");
    expect(parseOneDate("Sexta-feira", TODAY)).toBe("2026-09-25");
    expect(parseOneDate("terça", TODAY)).toBe("2026-09-22");
    expect(parseOneDate("sab", TODAY)).toBe("2026-09-26");
  });
  it("intervalos", () => {
    expect(parseDateArg("21/09 a 25/09", TODAY)).toEqual({ start: "2026-09-21", end: "2026-09-25" });
    expect(parseDateArg("hoje até sexta", TODAY)).toEqual({ start: "2026-09-21", end: "2026-09-25" });
    expect(parseDateArg("25/09 - 21/09", TODAY)).toEqual({ start: "2026-09-21", end: "2026-09-25" });
    expect(parseDateArg("30", TODAY)).toEqual({ start: "2026-09-30", end: "2026-09-30" });
    expect(parseDateArg("bla", TODAY)).toBeNull();
  });
  it("descreve com dia da semana e marca hoje/amanhã", () => {
    expect(describeRange({ start: TODAY, end: TODAY }, TODAY)).toBe("segunda, 21/09/2026 (hoje)");
    expect(describeRange({ start: "2026-09-22", end: "2026-09-22" }, TODAY)).toBe("terça, 22/09/2026 (amanhã)");
    expect(describeRange({ start: "2026-09-21", end: "2026-09-25" }, TODAY)).toBe("21/09/2026 a 25/09/2026");
  });
});

const acc = (id: string, name: string): Account => ({
  id, ownerId: "u", name, type: "checking", initialBalance: 0, currency: "BRL", archived: false, createdAt: 0,
});
const contact = (id: string, name: string): Contact => ({ id, ownerId: "u", name, kind: "customer", createdAt: 0 });
const bill = (p: Partial<Bill>): Bill => ({
  ownerId: "u", kind: "payable", description: "x", amount: 100, dueDate: TODAY, payments: [], createdAt: 0, ...p,
});
const accounts = [acc("c", "Cora"), acc("b", "Bradesco")];
const contacts = [contact("g", "Gialla"), contact("q", "Qpaozinho")];

describe("buildDayBillsMessages", () => {
  const bills = [
    bill({ id: "1", accountId: "c", amount: 50, description: "Luz", contactId: "q" }),
    bill({ id: "2", accountId: "b", amount: 30, description: "Água" }),
    bill({ id: "3", accountId: "c", amount: 20, description: "Atrasada", dueDate: "2026-09-15" }),
    bill({ id: "4", accountId: "c", amount: 999, description: "Futura", dueDate: "2026-09-25" }),
    bill({ id: "5", accountId: "c", amount: 100, description: "Paga", payments: [{ id: "p", date: TODAY, amount: 100 }] }),
    bill({ id: "6", kind: "receivable", contactId: "g", amount: 400, description: "Entregas semana", accountId: "c" }),
    bill({ id: "7", kind: "receivable", amount: 10, description: "Avulso" }),
  ];

  it("a pagar de um dia, por conta, com atrasados antes da data", () => {
    const msgs = buildDayBillsMessages("payable", bills, accounts, contacts, { start: TODAY, end: TODAY }, TODAY);
    expect(msgs).toHaveLength(1);
    const m = msgs[0].replace(/ /g, " ");
    expect(m).toContain("<b>📤 Contas a pagar — segunda, 21/09/2026 (hoje)</b>");
    expect(m).toContain("2 título(s) · total <b>R$ 80,00</b>");
    expect(m).toContain("🔴 Atrasados antes desta data: R$ 20,00");
    expect(m).toContain("<b>🏦 Bradesco</b> — 1 título(s) · <b>R$ 30,00</b>\n• Água · R$ 30,00");
    expect(m).toContain("<b>🏦 Cora</b> — 1 título(s) · <b>R$ 50,00</b>\n• Luz · Qpaozinho · R$ 50,00");
    expect(m).not.toContain("Futura");
    expect(m).not.toContain("Paga");
  });

  it("a receber de um intervalo, por contato, com a data em cada linha", () => {
    const msgs = buildDayBillsMessages(
      "receivable", bills, accounts, contacts, { start: "2026-09-21", end: "2026-09-25" }, TODAY,
    );
    const m = msgs[0].replace(/ /g, " ");
    expect(m).toContain("<b>📥 Contas a receber — 21/09/2026 a 25/09/2026</b>");
    expect(m).toContain("2 título(s) · total <b>R$ 410,00</b>");
    expect(m).toContain("<b>👤 Gialla</b> — 1 título(s) · <b>R$ 400,00</b>\n• 21/09 · Entregas semana · Cora · R$ 400,00");
    expect(m).toContain("<b>👤 Sem cliente definido</b>");
  });

  it("dia vazio", () => {
    const msgs = buildDayBillsMessages("payable", bills, accounts, contacts, { start: "2026-09-23", end: "2026-09-23" }, TODAY);
    expect(msgs[0]).toContain("Nenhum título a pagar neste dia");
  });
});
