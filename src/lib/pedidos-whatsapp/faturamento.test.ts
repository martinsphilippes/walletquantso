import { describe, it, expect } from "vitest";
import { computeFaturamento } from "./faturamento";
import type { ParsedRow } from "./parser";
import type { Client } from "@/types";

function client(p: Partial<Client>): Client {
  return { ownerId: "u1", name: "Pizzaria", createdAt: 0, ...p };
}

function row(p: Partial<ParsedRow>): ParsedRow {
  return { periodo: "—", cotacao: "0001", bairro: "Centro", telefone: "", dia: "06/08/2026", ...p };
}

describe("computeFaturamento", () => {
  const c = client({
    dailyRate: 90,
    zones: [
      { id: "z1", name: "Pituba", price: 10 },
      { id: "z2", name: "Rio Vermelho", price: 12.5 },
    ],
  });

  it("precifica entregas pela tabela de bairros (sem acento/caixa) e lista as sem preço", () => {
    const rows = [
      row({ bairro: "Pituba" }),
      row({ bairro: "pituba" }),
      row({ bairro: "Rio vermelho" }),
      row({ bairro: "Ondina" }),
    ];
    const f = computeFaturamento(c, rows);
    expect(f.entregas).toBe(4);
    expect(f.entregasValor).toBe(32.5); // 10 + 10 + 12,50
    expect(f.semPreco).toEqual([{ bairro: "Ondina", count: 1 }]);
  });

  it("conta diárias como turnos distintos de Dia × Período", () => {
    const rows = [
      row({ dia: "01/08/2026", periodo: "Noite" }),
      row({ dia: "01/08/2026", periodo: "Noite" }),
      row({ dia: "02/08/2026", periodo: "Noite" }),
      row({ dia: "03/08/2026", periodo: "Noite" }),
    ];
    const f = computeFaturamento(c, rows);
    expect(f.diariasDetectadas).toBe(3); // 3 dias diferentes, um turno cada
    expect(f.diariasValor).toBe(270);
    expect(f.turnos).toEqual(["Noite × 3"]);
    expect(f.total).toBe(270 + f.entregasValor);
  });

  it("mesmo dia com dois turnos = duas diárias", () => {
    const rows = [
      row({ dia: "01/08/2026", periodo: "Manhã" }),
      row({ dia: "01/08/2026", periodo: "Noite" }),
    ];
    expect(computeFaturamento(c, rows).diariasDetectadas).toBe(2);
  });

  it("aceita override das diárias e ignora diária quando o cliente não cobra", () => {
    const rows = [row({}), row({ dia: "07/08/2026" })];
    expect(computeFaturamento(c, rows, 5).diariasValor).toBe(450);
    const semDiaria = client({ zones: c.zones });
    expect(computeFaturamento(semDiaria, rows).diariasDetectadas).toBe(0);
  });
});
