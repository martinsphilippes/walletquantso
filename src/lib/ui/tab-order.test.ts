import { describe, it, expect } from "vitest";
import { tabTarget } from "./tab-order";

describe("tabTarget", () => {
  it("Tab vai para o próximo e Shift+Tab volta, dando a volta nas pontas", () => {
    expect(tabTarget(5, 1, 0, false)).toBe(2);
    expect(tabTarget(5, 1, 0, true)).toBe(0);
    expect(tabTarget(5, 4, 0, false)).toBe(0);
    expect(tabTarget(5, 0, 0, true)).toBe(4);
  });

  it("foco fora da lista: segue a partir de onde ele está na tela", () => {
    // Nenhum campo em foco: Tab vai para o primeiro, Shift+Tab para o último.
    expect(tabTarget(5, -1, 0, false)).toBe(0);
    expect(tabTarget(5, -1, 0, true)).toBe(4);
    // Foco num campo só de leitura entre o 2º e o 3º item.
    expect(tabTarget(5, -1, 2, false)).toBe(2);
    expect(tabTarget(5, -1, 2, true)).toBe(1);
    // Depois do último item: Tab dá a volta.
    expect(tabTarget(5, -1, 5, false)).toBe(0);
    expect(tabTarget(5, -1, 5, true)).toBe(4);
  });

  it("lista vazia não tem destino", () => {
    expect(tabTarget(0, -1, 0, false)).toBe(-1);
  });
});
