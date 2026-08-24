import { describe, it, expect } from "vitest";
import { buildCobrancaAoa, cobrancaFilename } from "./cobranca";
import { computeFaturamento } from "./faturamento";
import type { ParsedRow, ShiftRow } from "./parser";
import type { Client } from "@/types";

const client: Client = {
  ownerId: "u1",
  name: "Pizzaria Gialla",
  dailyRate: 70,
  zones: [
    { id: "z1", name: "Pituba", price: 13 },
    { id: "z2", name: "Brotas", price: 16 },
  ],
  createdAt: 0,
};

const rows: ParsedRow[] = [
  { periodo: "Noite", cotacao: "4583", bairro: "Pituba", telefone: "", dia: "09/08/2026" },
  { periodo: "Manhã", cotacao: "0963", bairro: "Pituba cancelado", telefone: "", dia: "07/08/2026" },
  { periodo: "Noite", cotacao: "7917", bairro: "Brotas", telefone: "", dia: "08/08/2026" },
];

const shifts: ShiftRow[] = [
  { name: "Erick", periodo: "Noite", dia: "09/08/2026" },
  { name: "Josias", periodo: "Manhã", dia: "07/08/2026" },
  { name: "Erick", periodo: "Noite", dia: "09/08/2026" }, // duplicata (print sobreposto)
];

describe("buildCobrancaAoa", () => {
  const fat = computeFaturamento(client, rows, undefined, shifts);
  const aoa = buildCobrancaAoa(client, rows, shifts, fat, new Date(2026, 7, 10, 21, 0));
  const flat = aoa.map((r) => r.join("|"));

  it("traz cabeçalho com cliente e período trabalhado", () => {
    expect(flat[0]).toContain("Pizzaria Gialla");
    expect(flat[1]).toContain("07/08/2026 a 09/08/2026");
  });

  it("lista as entregas em ordem cronológica com preço da tabela", () => {
    const i = flat.indexOf("ENTREGAS");
    expect(i).toBeGreaterThan(-1);
    expect(flat[i + 2]).toContain("0963|Pituba cancelado|07/08/2026|Manhã|13");
    expect(flat[i + 3]).toContain("7917|Brotas|08/08/2026|Noite|16");
    expect(flat[i + 5]).toContain("Total de entregas|3");
    expect(flat[i + 5]).toContain("42"); // 13 + 13 + 16
  });

  it("lista os motoboys sem duplicar e soma as diárias", () => {
    const i = flat.indexOf("DIÁRIAS (MOTOBOYS)");
    expect(flat[i + 2]).toContain("Josias|07/08/2026|Manhã");
    expect(flat[i + 3]).toContain("Erick|09/08/2026|Noite");
    // 2 declaradas (Josias, Erick) + 1 do dia 08/08, que tem entrega mas
    // nenhuma diária declarada.
    expect(flat[i + 4]).toContain("Total de diárias|3");
    expect(flat[i + 4]).toContain("210");
  });

  it("mostra o total a pagar e a tabela de preços para conferência", () => {
    expect(flat.find((l) => l.startsWith("TOTAL A PAGAR"))).toContain("252"); // 42 + 210
    const i = flat.indexOf("TABELA DE PREÇOS POR BAIRRO");
    expect(flat[i + 2]).toContain("Brotas");
    expect(flat[i + 3]).toContain("Pituba");
  });

  it("nomeia o arquivo com o cliente e a data", () => {
    expect(cobrancaFilename(client, new Date(2026, 7, 10))).toBe(
      "cobranca_pizzaria-gialla_2026-08-10.xlsx",
    );
  });
});
