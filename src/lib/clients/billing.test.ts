import { describe, it, expect } from "vitest";
import { computeCharge, chargeDescription, revenueParts } from "./billing";
import type { Client } from "@/types";

function client(p: Partial<Client>): Client {
  return { ownerId: "u1", name: "Cliente", createdAt: 0, ...p };
}

describe("computeCharge", () => {
  it("cobra diárias por turno (manhã + tarde) pelo valor da diária", () => {
    const c = client({ name: "Pizzaria", dailyRate: 90 });
    const charge = computeCharge(c, { morningShifts: 1, afternoonShifts: 2 });
    expect(charge.total).toBe(270);
    expect(charge.lines).toEqual(["1 diária(s) manhã + 2 diária(s) tarde"]);
  });

  it("cobra entregas pela tabela de bairros (preço × quantidade)", () => {
    const c = client({
      name: "Restaurante",
      zones: [
        { id: "z1", name: "Centro", price: 8 },
        { id: "z2", name: "Alphaville", price: 15.5 },
      ],
    });
    const charge = computeCharge(c, { deliveries: { z1: 10, z2: 2 } });
    expect(charge.total).toBe(111); // 80 + 31
    expect(charge.lines).toEqual(["10x Centro", "2x Alphaville"]);
  });

  it("cobra percentual sobre o faturamento entregue (fábrica: 12%)", () => {
    const c = client({ name: "Fábrica de Salgados", revenuePercent: 12 });
    const charge = computeCharge(c, { revenue: 2000 });
    expect(charge.total).toBe(240);
    expect(charge.lines[0]).toContain("12% de");
  });

  it("caminho inverso: digitando o valor do título, deduz o faturamento (valor ÷ %)", () => {
    const c = client({ name: "Qpaozinho", revenuePercent: 12 });
    expect(revenueParts(c, { revenueValue: 150 })).toEqual({ base: 1250, value: 150 });
    expect(revenueParts(c, { revenue: 2000 })).toEqual({ base: 2000, value: 240 });
    // O valor digitado vale exato, mesmo quando a base não fecha em centavos.
    expect(revenueParts(c, { revenueValue: 100 })).toEqual({ base: 833.33, value: 100 });
    const charge = computeCharge(c, { revenueValue: 100 });
    expect(charge.total).toBe(100);
    expect(charge.lines[0].replace(/ /g, " ")).toBe("12% de R$ 833,33");
    // O valor digitado tem prioridade sobre o faturamento, e sem percentual não há nada.
    expect(revenueParts(c, { revenue: 2000, revenueValue: 150 })?.value).toBe(150);
    expect(revenueParts(client({ name: "x" }), { revenueValue: 150 })).toBeNull();
  });

  it("combina diária + entregas + percentual no mesmo título", () => {
    const c = client({
      dailyRate: 100,
      revenuePercent: 10,
      zones: [{ id: "z1", name: "Centro", price: 5 }],
    });
    const charge = computeCharge(c, {
      morningShifts: 1,
      deliveries: { z1: 4 },
      revenue: 500,
    });
    expect(charge.total).toBe(170); // 100 + 20 + 50
    expect(charge.lines).toHaveLength(3);
  });

  it("ignora quantidades zeradas/negativas e regras não usadas", () => {
    const c = client({ dailyRate: 100, zones: [{ id: "z1", name: "Centro", price: 5 }] });
    const charge = computeCharge(c, { morningShifts: 0, deliveries: { z1: -3 } });
    expect(charge.total).toBe(0);
    expect(charge.lines).toEqual([]);
  });

  it("monta a descrição do título com o nome do cliente", () => {
    const c = client({ name: "Pizzaria Gialla", dailyRate: 90 });
    const charge = computeCharge(c, { afternoonShifts: 1 });
    expect(chargeDescription(c, charge)).toBe("Pizzaria Gialla — 1 diária(s) tarde");
    expect(chargeDescription(c, charge, "semanal")).toBe("Pizzaria Gialla — Semanal — 1 diária(s) tarde");
    expect(chargeDescription(c, charge, "mensal")).toBe("Pizzaria Gialla — Mensal — 1 diária(s) tarde");
  });
});
