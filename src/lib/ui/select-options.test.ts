import { describe, it, expect } from "vitest";
import { createElement as h, Fragment } from "react";
import {
  edgeIndex,
  optionsFromChildren,
  shownIndex,
  stepIndex,
  textOf,
  typeAheadIndex,
  widestLabels,
  type ChoiceOption,
} from "./select-options";

const opts = (...labels: string[]): ChoiceOption[] =>
  labels.map((label, i) => ({ value: String(i), label, disabled: false }));

describe("optionsFromChildren", () => {
  it("lê as <option> de listas, fragmentos, optgroup e condições", () => {
    const children = [
      h("option", { key: "n", value: "" }, "— nenhum —"),
      [h("option", { key: "a", value: "a" }, "Banco (", "Inter", ")"), h("option", { key: "b", value: 2 }, "Bradesco")],
      false,
      null,
      h(Fragment, { key: "f" }, h("option", { value: "c" }, "Caixa")),
      h("optgroup", { key: "g", label: "Outros" }, h("option", { value: "d", disabled: true }, "Desativada")),
    ];
    expect(optionsFromChildren(children)).toEqual([
      { value: "", label: "— nenhum —", disabled: false },
      { value: "a", label: "Banco (Inter)", disabled: false },
      { value: "2", label: "Bradesco", disabled: false },
      { value: "c", label: "Caixa", disabled: false },
      { value: "d", label: "Desativada", disabled: true },
    ]);
  });

  it("sem value, o texto vira o valor (como no <select>) e os espaços se juntam", () => {
    expect(optionsFromChildren(h("option", null, "  Dinheiro \n  vivo "))).toEqual([
      { value: "Dinheiro vivo", label: "Dinheiro vivo", disabled: false },
    ]);
  });

  it("textOf junta o texto de elementos aninhados", () => {
    expect(textOf(["R$ ", 10, h("b", null, " pago")])).toBe("R$ 10 pago");
  });
});

describe("shownIndex", () => {
  it("mostra o item do valor; sem ele, o primeiro disponível", () => {
    const o = opts("Escolha…", "Inter", "Cora");
    expect(shownIndex(o, "2")).toBe(2);
    expect(shownIndex(o, "zz")).toBe(0);
    o[0].disabled = true;
    expect(shownIndex(o, "zz")).toBe(1);
    expect(shownIndex([], "")).toBe(-1);
  });
});

describe("stepIndex / edgeIndex", () => {
  it("anda sem dar a volta e pula os desabilitados", () => {
    const o = opts("a", "b", "c", "d");
    o[2].disabled = true;
    expect(stepIndex(o, 1, 1)).toBe(3);
    expect(stepIndex(o, 3, -1)).toBe(1);
    expect(stepIndex(o, 3, 1)).toBe(3);
    expect(stepIndex(o, 0, -1)).toBe(0);
    expect(stepIndex(o, 0, 8)).toBe(3);
  });

  it("sem item marcado, desce ao primeiro e sobe ao último", () => {
    const o = opts("a", "b", "c");
    expect(stepIndex(o, -1, 1)).toBe(0);
    expect(stepIndex(o, -1, -1)).toBe(2);
    expect(edgeIndex(o, 1)).toBe(0);
    expect(edgeIndex(o, -1)).toBe(2);
    expect(stepIndex([], -1, 1)).toBe(-1);
  });
});

describe("typeAheadIndex", () => {
  const o = opts("Banco Inter", "Bradesco", "Caixa", "Água e luz");

  it("uma letra passa para o próximo item com essa inicial, dando a volta", () => {
    expect(typeAheadIndex(o, "b", 0)).toBe(1);
    expect(typeAheadIndex(o, "b", 1)).toBe(0);
    expect(typeAheadIndex(o, "bb", 1)).toBe(0);
    expect(typeAheadIndex(o, "c", -1)).toBe(2);
  });

  it("um começo maior procura a partir do item atual, sem acento e sem diferença de maiúscula", () => {
    expect(typeAheadIndex(o, "ba", 1)).toBe(0);
    expect(typeAheadIndex(o, "BRA", 0)).toBe(1);
    expect(typeAheadIndex(o, "agua", 0)).toBe(3);
    expect(typeAheadIndex(o, "xyz", 0)).toBe(-1);
    expect(typeAheadIndex(o, "", 0)).toBe(-1);
  });

  it("não escolhe item desabilitado", () => {
    const d = opts("Cora", "Caixa");
    d[1].disabled = true;
    expect(typeAheadIndex(d, "c", 0)).toBe(0);
  });
});

describe("widestLabels", () => {
  it("pega os textos mais compridos, sem repetir", () => {
    expect(widestLabels(opts("a", "ccc", "bb", "ccc", "dddd"), 2)).toEqual(["dddd", "ccc"]);
  });
});
