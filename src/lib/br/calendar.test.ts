import { describe, it, expect } from "vitest";
import {
  addMonths,
  daysInMonth,
  longDate,
  monthGrid,
  monthTitle,
  shiftDays,
  shiftMonth,
  shortDate,
  weekdayOf,
} from "./calendar";

describe("calendar", () => {
  it("dia da semana e nomes por extenso", () => {
    expect(weekdayOf("2026-10-08")).toBe(4); // quinta
    expect(weekdayOf("2026-10-11")).toBe(0); // domingo
    expect(longDate("2026-10-08")).toBe("quinta-feira, 8 de outubro de 2026");
    expect(longDate("2026-10-11")).toBe("domingo, 11 de outubro de 2026");
    expect(shortDate("2026-10-08")).toBe("qui, 08/10/2026");
    expect(shortDate("2026-01-03")).toBe("sáb, 03/01/2026");
    expect(monthTitle(2026, 3)).toBe("março de 2026");
  });

  it("dias do mês e troca de mês/ano", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(addMonths(2026, 12, 1)).toEqual({ y: 2027, m: 1 });
    expect(addMonths(2026, 1, -1)).toEqual({ y: 2025, m: 12 });
    expect(addMonths(2026, 10, 12)).toEqual({ y: 2027, m: 10 });
    expect(shiftMonth("2026-01-31", 1)).toBe("2026-02-28");
    expect(shiftDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("grade começa no domingo da semana do dia 1 e tem 6 semanas", () => {
    const g = monthGrid(2026, 10); // 1/out/2026 é quinta
    expect(g).toHaveLength(42);
    expect(g[0]).toEqual({ iso: "2026-09-27", inMonth: false });
    expect(g[4]).toEqual({ iso: "2026-10-01", inMonth: true });
    expect(g[34]).toEqual({ iso: "2026-10-31", inMonth: true });
    expect(g[35].inMonth).toBe(false);
    expect(g[41].iso).toBe("2026-11-07");
    // Mês que começa no domingo: sem dias do mês anterior na primeira linha.
    expect(monthGrid(2026, 11)[0]).toEqual({ iso: "2026-11-01", inMonth: true });
  });
});
