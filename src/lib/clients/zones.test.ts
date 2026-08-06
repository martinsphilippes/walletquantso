import { describe, it, expect } from "vitest";
import { zonesFromMatrix } from "./zones";

describe("zonesFromMatrix", () => {
  it("extrai bairro + preço, pulando a linha de cabeçalho", () => {
    const { zones, skipped } = zonesFromMatrix([
      ["Bairro", "Valor"],
      ["Centro", 8],
      ["Alphaville", "15,50"],
      ["Jardim América", "R$ 12,00"],
    ]);
    expect(zones).toEqual([
      { name: "Centro", price: 8 },
      { name: "Alphaville", price: 15.5 },
      { name: "Jardim América", price: 12 },
    ]);
    expect(skipped).toBe(1); // o cabeçalho
  });

  it("aceita nome com número (Centro 2) e ignora linhas sem preço", () => {
    const { zones, skipped } = zonesFromMatrix([
      ["Centro 2", "9,00"],
      ["Sem preço", ""],
      ["", ""],
    ]);
    expect(zones).toEqual([{ name: "Centro 2", price: 9 }]);
    expect(skipped).toBe(1); // "Sem preço" (a linha vazia não conta)
  });

  it("descarta bairros duplicados (mantém o primeiro)", () => {
    const { zones, skipped } = zonesFromMatrix([
      ["Centro", 8],
      ["centro", 10],
    ]);
    expect(zones).toEqual([{ name: "Centro", price: 8 }]);
    expect(skipped).toBe(1);
  });
});
