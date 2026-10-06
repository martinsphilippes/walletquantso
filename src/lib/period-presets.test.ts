import { describe, it, expect } from "vitest";
import { decodePeriod, encodeCustomPeriod } from "./period-presets";

describe("período personalizado salvo", () => {
  it("data final igual a hoje é 'até hoje' e acompanha o calendário", () => {
    // Dia 05/10: usuário mudou só a inicial; a final era "hoje" (de um preset).
    const saved = encodeCustomPeriod("2026-09-01", "2026-10-05", "2026-10-05");
    expect(saved.toToday).toBe(true);
    // Dia 06/10: o lançamento de hoje continua dentro do período.
    expect(decodePeriod(saved, "2026-10-06")).toEqual({ from: "2026-09-01", to: "2026-10-06" });
  });

  it("data final num dia passado fica fixa (foi escolha do usuário)", () => {
    const saved = encodeCustomPeriod("2026-09-01", "2026-09-30", "2026-10-05");
    expect(saved.toToday).toBe(false);
    expect(decodePeriod(saved, "2026-10-06")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("final vazia continua vazia (sem limite)", () => {
    const saved = encodeCustomPeriod("2026-09-01", "", "2026-10-05");
    expect(decodePeriod(saved, "2026-10-06")).toEqual({ from: "2026-09-01", to: "" });
  });

  it("registro antigo sem a marca 'toToday' é lido como estava", () => {
    expect(decodePeriod({ preset: "custom", from: "2026-09-01", to: "2026-10-05" }, "2026-10-06")).toEqual({
      from: "2026-09-01",
      to: "2026-10-05",
    });
  });

  it("presets continuam calculados na leitura", () => {
    expect(decodePeriod({ preset: "all" }, "2026-10-06")).toEqual({ from: "", to: "" });
    expect(decodePeriod({ preset: "xyz" }, "2026-10-06")).toBeNull();
  });
});
