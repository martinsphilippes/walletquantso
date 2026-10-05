import { describe, it, expect } from "vitest";
import { applyColumnFilters, type ColFilterDef } from "./ColumnFilter";

interface Row {
  conta: string;
  desc: string;
}
const rows: Row[] = [
  { conta: "C6", desc: "Luz" },
  { conta: "Cora Quantso", desc: "Água" },
  { conta: "Depix", desc: "Pix" },
  { conta: "C6 → Cora Quantso", desc: "Transferência" },
];
const defs: ColFilterDef<Row>[] = [
  { key: "conta", type: "select", value: (r) => r.conta },
  { key: "desc", value: (r) => r.desc },
];
const descs = (f: Parameters<typeof applyColumnFilters<Row>>[2]) =>
  applyColumnFilters(rows, defs, f).map((r) => r.desc);

describe("applyColumnFilters", () => {
  it("coluna de seleção aceita vários valores (qualquer um deles)", () => {
    expect(descs({ conta: ["C6", "Depix"] })).toEqual(["Luz", "Pix"]);
    expect(descs({ conta: ["Cora Quantso", "C6 → Cora Quantso"] })).toEqual(["Água", "Transferência"]);
  });
  it("lista vazia não filtra; valor antigo em texto continua valendo", () => {
    expect(descs({ conta: [] })).toHaveLength(4);
    expect(descs({ conta: "Depix" })).toEqual(["Pix"]);
  });
  it("combina com a busca de texto de outra coluna", () => {
    expect(descs({ conta: ["C6", "Depix"], desc: "PI" })).toEqual(["Pix"]);
  });
});
