import { describe, it, expect } from "vitest";
import { nextPayDate, computeDriverPayout, nextWeekdayDate, payDueDate, describeDue } from "./pay";
import type { RideEntry } from "@/types";

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

describe("computeDriverPayout", () => {
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
  const rates = { diariaValue: 70, corridaValue: 8 };

  it("soma diárias e corridas em aberto do motorista, por empresa e período", () => {
    const rides = [
      ride({ id: "r1", diarias: 1, corridas: 10, date: "2026-09-08" }),
      ride({ id: "r2", diarias: 1, corridas: 12, date: "2026-09-09", clientId: "c2" }),
      ride({ id: "r3", diarias: 1, corridas: 5, date: "2026-09-10" }),
      ride({ id: "r4", diarias: 1, corridas: 9, driverId: "d2" }), // outro motorista
      ride({ id: "r5", diarias: 1, corridas: 3, billId: "b1" }), // já faturado
    ];
    const p = computeDriverPayout(rides, "d1", rates);
    expect(p.diarias).toBe(3);
    expect(p.corridas).toBe(27);
    expect(p.diariasValor).toBe(210);
    expect(p.corridasValor).toBe(216);
    expect(p.total).toBe(426);
    expect(p.period).toBe("08/09/2026 a 10/09/2026");
    expect(p.rideIds.sort()).toEqual(["r1", "r2", "r3"]);
    expect(p.porEmpresa[0]).toEqual({ clientId: "c1", diarias: 2, corridas: 15 });
  });

  it("sem corridas em aberto: tudo zero e período nulo", () => {
    const p = computeDriverPayout([], "d1", rates);
    expect(p.total).toBe(0);
    expect(p.period).toBeNull();
    expect(p.rideIds).toEqual([]);
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
    expect(payDueDate("2026-09-16", { payDay: 20 })).toBe("2026-09-20"); // sem modo = dia do mês
  });
});
