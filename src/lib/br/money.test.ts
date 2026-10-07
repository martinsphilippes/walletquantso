import { describe, it, expect } from "vitest";
import { brl, hasSubCents, round4 } from "./money";

const norm = (s: string) => s.replace(/ /g, " ");

describe("brl com fração de centavo", () => {
  it("valores normais ficam com 2 casas", () => {
    expect(norm(brl(400))).toBe("R$ 400,00");
    expect(norm(brl(8.13))).toBe("R$ 8,13");
    expect(norm(brl(-11.06))).toBe("-R$ 11,06");
  });
  it("valores com fração de centavo mostram as casas reais", () => {
    expect(norm(brl(0.425))).toBe("R$ 0,425");
    expect(norm(brl(21.325))).toBe("R$ 21,325");
    expect(norm(brl(1.4321))).toBe("R$ 1,4321");
  });
  it("hasSubCents / round4", () => {
    expect(hasSubCents(0.43)).toBe(false);
    expect(hasSubCents(0.425)).toBe(true);
    expect(round4(0.1 + 0.2)).toBe(0.3);
    expect(round4(1 + 0.425)).toBe(1.425);
  });
});
