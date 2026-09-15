import { describe, it, expect } from "vitest";
import {
  nextPayDate,
  computeDriverPayout,
  nextWeekdayDate,
  payDueDate,
  describeDue,
  ruleForClient,
  ratesOf,
  diariasOf,
} from "./pay";
import type { ClientPayRule, DriverSettings, RideEntry } from "@/types";

describe("nextPayDate", () => {
  it("dia ainda não passou (ou é hoje): vence neste mês", () => {
    expect(nextPayDate("2026-09-03", 5)).toBe("2026-09-05");
    expect(nextPayDate("2026-09-05", 5)).toBe("2026-09-05");
  });
  it("dia já passou: vence no mês seguinte", () => {
    expect(nextPayDate("2026-09-10", 5)).toBe("2026-10-05");
  });
  it("vira o ano", () => {
    expect(nextPayDate("2026-12-20", 10)).toBe("2027-01-10");
  });
  it("dia 31 em mês curto vira o último dia", () => {
    expect(nextPayDate("2026-02-01", 31)).toBe("2026-02-28");
    expect(nextPayDate("2026-04-05", 31)).toBe("2026-04-30");
  });
});

describe("nextWeekdayDate / payDueDate / describeDue", () => {
  // 15/09/2026 é terça-feira.
  it("gerando na própria terça, a 'próxima terça' é hoje", () => {
    expect(nextWeekdayDate("2026-09-15", 2)).toBe("2026-09-15");
    expect(describeDue("2026-09-15", "2026-09-15")).toBe("Hoje");
  });
  it("quarta pedindo terça → terça da semana que vem", () => {
    expect(nextWeekdayDate("2026-09-16", 2)).toBe("2026-09-22");
    expect(describeDue("2026-09-16", "2026-09-22")).toBe("terça-feira, 22/09");
  });
  it("segunda pedindo terça → amanhã", () => {
    expect(nextWeekdayDate("2026-09-14", 2)).toBe("2026-09-15");
    expect(describeDue("2026-09-14", "2026-09-15")).toBe("Amanhã (15/09)");
  });
  it("sexta pedindo segunda → segunda seguinte (vira o mês se precisar)", () => {
    expect(nextWeekdayDate("2026-09-25", 1)).toBe("2026-09-28");
    expect(nextWeekdayDate("2026-10-30", 1)).toBe("2026-11-02");
  });
  it("payDueDate escolhe o modo", () => {
    expect(payDueDate("2026-09-16", { payMode: "weekday", payDay: 5, payWeekday: 2 })).toBe("2026-09-22");
    expect(payDueDate("2026-09-16", { payMode: "monthDay", payDay: 5 })).toBe("2026-10-05");
    expect(payDueDate("2026-09-16", { payDay: 20 })).toBe("2026-09-20");
  });
});

const ride = (p: Partial<RideEntry>): RideEntry => ({
  ownerId: "u",
  driverId: "d1",
  clientId: "c1",
  date: "2026-09-10",
  diarias: 0,
  corridas: 0,
  notes: null,
  createdAt: 0,
  createdBy: "x",
  billId: null,
  ...p,
});

describe("computeDriverPayout", () => {
  // Qpaozinho: diária 70, corrida Normal R$ 8 e corrida Longa R$ 12.
  const rule: ClientPayRule = {
    payMode: "weekday",
    payDay: 5,
    payWeekday: 2,
    diariaValue: 70,
    rates: [
      { id: "n", label: "Normal", value: 8 },
      { id: "l", label: "Longa", value: 12 },
    ],
  };

  it("soma diárias e corridas por taxa do motorista NAQUELA empresa", () => {
    const rides = [
      ride({ id: "r1", diarias: 1, corridas: 10, corridasPorTaxa: { n: 7, l: 3 }, date: "2026-09-08" }),
      ride({ id: "r2", diarias: 1, corridas: 12, corridasPorTaxa: { n: 12 }, date: "2026-09-09", clientId: "c2" }), // outra empresa
      ride({ id: "r3", diarias: 1, corridas: 5, corridasPorTaxa: { l: 5 }, date: "2026-09-10" }),
      ride({ id: "r4", diarias: 1, corridas: 9, corridasPorTaxa: { n: 9 }, driverId: "d2" }), // outro motorista
      ride({ id: "r5", diarias: 1, corridas: 3, corridasPorTaxa: { n: 3 }, billId: "b1" }), // já faturado
    ];
    const p = computeDriverPayout(rides, "d1", "c1", rule);
    expect(p.diarias).toBe(2);
    expect(p.corridas).toBe(15);
    expect(p.diariasValor).toBe(140);
    expect(p.corridasValor).toBe(7 * 8 + 8 * 12); // 56 + 96 = 152
    expect(p.total).toBe(292);
    expect(p.period).toBe("08/09/2026 a 10/09/2026");
    expect(p.rideIds.sort()).toEqual(["r1", "r3"]);
    expect(p.porTaxa).toEqual([
      { id: "n", label: "Normal", value: 8, qty: 7, total: 56 },
      { id: "l", label: "Longa", value: 12, qty: 8, total: 96 },
    ]);
  });

  it("lançamento antigo sem taxa conta na primeira taxa", () => {
    const p = computeDriverPayout([ride({ id: "r1", corridas: 4 })], "d1", "c1", rule);
    expect(p.corridasValor).toBe(32);
    expect(p.porTaxa[0].label).toBe("Normal");
  });

  it("taxa removida da regra aparece com valor zero (não some do total de corridas)", () => {
    const p = computeDriverPayout([ride({ id: "r1", corridas: 2, corridasPorTaxa: { x: 2 } })], "d1", "c1", rule);
    expect(p.corridas).toBe(2);
    expect(p.corridasValor).toBe(0);
    expect(p.porTaxa[0].label).toBe("taxa removida");
  });

  it("diárias por tipo (manhã/tarde/noite) com valores diferentes", () => {
    const r: ClientPayRule = {
      ...rule,
      diariaValue: 0,
      diarias: [
        { id: "m", label: "Manhã", value: 50 },
        { id: "t", label: "Tarde", value: 60 },
        { id: "no", label: "Noite", value: 80 },
      ],
    };
    const rides = [
      ride({ id: "r1", diarias: 2, diariasPorTipo: { m: 1, t: 1 } }),
      ride({ id: "r2", diarias: 1, diariasPorTipo: { no: 1 } }),
    ];
    const p = computeDriverPayout(rides, "d1", "c1", r);
    expect(p.diarias).toBe(3);
    expect(p.diariasValor).toBe(190);
    expect(p.porDiaria.map((d) => `${d.label}:${d.qty}=${d.total}`)).toEqual(["Manhã:1=50", "Tarde:1=60", "Noite:1=80"]);
  });

  it("lançamento antigo sem tipo de diária conta no primeiro tipo; valor único vira 'Diária'", () => {
    const p = computeDriverPayout([ride({ id: "r1", diarias: 2 })], "d1", "c1", rule);
    expect(p.diariasValor).toBe(140);
    expect(p.porDiaria).toEqual([{ id: "default", label: "Diária", value: 70, qty: 2, total: 140 }]);
    expect(diariasOf(rule)).toEqual([{ id: "default", label: "Diária", value: 70 }]);
  });

  it("valor avulso com justificativa entra no total", () => {
    const rides = [
      ride({ id: "r1", diarias: 1, corridas: 2, corridasPorTaxa: { n: 2 }, extraValue: 30, extraDescription: "Gasolina" }),
      ride({ id: "r2", extraValue: 15.5, extraDescription: "  " }),
    ];
    const p = computeDriverPayout(rides, "d1", "c1", rule);
    expect(p.avulsosValor).toBe(45.5);
    expect(p.avulsos.map((a) => a.description)).toEqual(["Gasolina", "Valor avulso"]);
    expect(p.total).toBe(70 + 16 + 45.5);
    expect(p.rideIds.sort()).toEqual(["r1", "r2"]);
  });

  it("sem corridas em aberto: tudo zero e período nulo", () => {
    const p = computeDriverPayout([], "d1", "c1", rule);
    expect(p.total).toBe(0);
    expect(p.period).toBeNull();
    expect(p.rideIds).toEqual([]);
  });
});

describe("ruleForClient / ratesOf", () => {
  const base: DriverSettings = { ownerId: "u", accountId: null, categoryId: null, costCenterId: null, updatedAt: 0 };

  it("regra própria da empresa, com suas taxas", () => {
    const s: DriverSettings = {
      ...base,
      byClient: {
        qp: { payMode: "weekday", payDay: 5, payWeekday: 2, diariaValue: 25, rates: [{ id: "a", label: "Normal", value: 8 }, { id: "b", label: "Longa", value: 12 }] },
      },
    };
    expect(ruleForClient(s, "qp")?.rates.map((r) => r.value)).toEqual([8, 12]);
    expect(ruleForClient(s, "outro")).toBeNull();
  });

  it("regra compartilhada antiga (vários clientes, valor único) vira uma taxa 'Corrida'", () => {
    const s: DriverSettings = {
      ...base,
      rules: [{ id: "r1", payMode: "weekday", payDay: 5, payWeekday: 2, diariaValue: 25, corridaValue: 8, rates: [], clientIds: ["gialla"] }],
    };
    expect(ruleForClient(s, "gialla")?.rates).toEqual([{ id: "default", label: "Corrida", value: 8 }]);
  });

  it("regra única da primeira versão vale como padrão", () => {
    const s: DriverSettings = { ...base, payMode: "monthDay", payDay: 5, diariaValue: 70, corridaValue: 8 };
    expect(ratesOf(ruleForClient(s, "qualquer")!)[0].value).toBe(8);
  });

  it("sem configuração nenhuma: null", () => {
    expect(ruleForClient(null, "c1")).toBeNull();
    expect(ruleForClient(base, "c1")).toBeNull();
  });
});
