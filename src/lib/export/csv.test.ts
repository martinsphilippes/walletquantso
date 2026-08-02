import { describe, it, expect } from "vitest";
import { toCsv, brNumber, brDate, transactionsToCsv } from "./csv";
import type { Transaction } from "@/types";

describe("toCsv", () => {
  it("joins rows with ; and CRLF", () => {
    expect(toCsv([["a", "b"], ["c", "d"]])).toBe("a;b\r\nc;d");
  });

  it("quotes cells containing delimiter, quotes or newlines", () => {
    expect(toCsv([["a;b", 'has "quote"', "line\nbreak"]])).toBe(
      '"a;b";"has ""quote""";"line\nbreak"',
    );
  });

  it("renders null/undefined as empty", () => {
    expect(toCsv([[null, undefined, "x"]])).toBe(";;x");
  });
});

describe("brNumber / brDate", () => {
  it("formats numbers with comma and two decimals", () => {
    expect(brNumber(12.2)).toBe("12,20");
    expect(brNumber(1000)).toBe("1000,00");
  });
  it("formats ISO date to dd/mm/aaaa", () => {
    expect(brDate("2025-08-28")).toBe("28/08/2025");
  });
});

describe("transactionsToCsv", () => {
  function tx(p: Partial<Transaction>): Transaction {
    return {
      ownerId: "u",
      date: "2025-01-05",
      amount: 50,
      type: "expense",
      description: "Mercado",
      accountId: "acc1",
      dedupHash: "h",
      createdAt: 0,
      ...p,
    };
  }
  const names = {
    account: (id?: string | null) => (id === "acc1" ? "Nubank" : id === "acc2" ? "Itaú" : ""),
    category: (id?: string | null) => (id === "food" ? "Alimentação" : ""),
  };

  it("includes a header and signed BR values", () => {
    const csv = transactionsToCsv([tx({ categoryId: "food" })], names);
    const lines = csv.split("\r\n");
    expect(lines[0]).toContain("Data;Descrição;Tipo");
    expect(lines[1]).toBe("05/01/2025;Mercado;Despesa;Alimentação;Nubank;;-50,00;");
  });

  it("shows transfer destination", () => {
    const csv = transactionsToCsv(
      [tx({ type: "transfer", accountId: "acc1", transferAccountId: "acc2", amount: 200, description: "TED" })],
      names,
    );
    expect(csv.split("\r\n")[1]).toBe("05/01/2025;TED;Transferência;;Nubank;Itaú;200,00;");
  });

  it("adds cost center and contact columns when lookups are provided", () => {
    const csv = transactionsToCsv(
      [tx({ categoryId: "food", costCenterId: "cc1", contactId: "p1" })],
      {
        ...names,
        costCenter: (id?: string | null) => (id === "cc1" ? "Casa" : ""),
        contact: (id?: string | null) => (id === "p1" ? "Padaria" : ""),
      },
    );
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(
      "Data;Descrição;Tipo;Categoria;Centro de custo;Pessoa/contato;Conta;Conta destino;Valor;Observações",
    );
    expect(lines[1]).toBe("05/01/2025;Mercado;Despesa;Alimentação;Casa;Padaria;Nubank;;-50,00;");
  });
});
