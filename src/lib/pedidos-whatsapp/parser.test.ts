import { describe, it, expect } from "vitest";
import { parseConversation } from "./parser";

// Monday, July 27 2026 -- a fixed "today" so date-resolution assertions are
// deterministic. Matches the date used while validating this parser in the
// original Dia-Dia tool.
const TODAY = new Date(2026, 6, 27);

describe("parseConversation — numeric format", () => {
  it("parses *MANHÃ*/*NOITE* headers with NÚMERO- Bairro lines", () => {
    const text = `*MANHÃ*

7143- Caminho das Árvores
2294- Pituaçu
0574- Pituba

*NOITE*

1436- Pituba
7862- Pituba
0292- Pituba`;
    const { rows } = parseConversation(text, TODAY);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toEqual({ periodo: "Manhã", cotacao: "7143", bairro: "Caminho das Árvores", telefone: "", dia: "" });
    expect(rows[2].cotacao).toBe("0574"); // leading zero preserved
    expect(rows[3].periodo).toBe("Noite");
  });
});

describe("parseConversation — name-based format", () => {
  it("parses Nome - Bairro lines, stripping leading junk characters", () => {
    const text = `Isabela - Ondina
Elaine - Ondina
Ney - Barra
Maurício - Graça
*Isabela - ondina
- Elaine - ondina
• Ney - barra`;
    const { rows } = parseConversation(text, TODAY);
    expect(rows).toHaveLength(7);
    expect(rows[0]).toMatchObject({ cotacao: "Isabela", bairro: "Ondina", periodo: "—" });
    expect(rows[4]).toMatchObject({ cotacao: "Isabela", bairro: "ondina" });
    expect(rows[6]).toMatchObject({ cotacao: "Ney", bairro: "barra" });
  });
});

describe("parseConversation — weekday/date column", () => {
  it("resolves a weekday name to the most recent already-passed date", () => {
    // Monday July 27 2026 -> most recent past Wednesday = July 22 2026
    const { rows } = parseConversation("*MANHÃ*\n7143- Caminho das Árvores", TODAY);
    expect(rows[0].dia).toBe("");

    const withDay = parseConversation("quarta-feira\n7143- Caminho das Árvores", TODAY);
    expect(withDay.rows[0].dia).toBe("22/07/2026");
  });

  it("resolves 'Ontem' to yesterday", () => {
    const { rows } = parseConversation("Ontem\n1234- Pituba", TODAY);
    expect(rows[0].dia).toBe("26/07/2026");
  });

  it("uses the explicit date of a marker like 'Sexta-feira 07/08/26' (no fake row)", () => {
    const { rows, skipped } = parseConversation(
      "Sexta-feira 07/08/26\n* João - Vitória",
      TODAY,
    );
    expect(skipped).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].dia).toBe("07/08/2026");
    expect(rows[0].cotacao).toBe("João");
  });

  it("accepts OCR dash lookalikes in Nome − Bairro lines", () => {
    // U+2212 (minus) and U+2011 (non-breaking hyphen) instead of "-".
    const { rows, skipped } = parseConversation(
      "* Maria − Pituba\n* Luis ‑ Garcia",
      TODAY,
    );
    expect(skipped).toEqual([]);
    expect(rows.map((r) => `${r.cotacao}|${r.bairro}`)).toEqual([
      "Maria|Pituba",
      "Luis|Garcia",
    ]);
  });

  it("recognizes space, hyphen, and spaced-hyphen 'feira' forms the same way", () => {
    const cases = ["Quinta feira", "Quinta-feira", "Quinta - Feira", "QUINTA FEIRA"];
    for (const line of cases) {
      const { rows, skipped } = parseConversation(`${line}\n1234- Pituba`, TODAY);
      expect(skipped).toEqual([]);
      expect(rows).toHaveLength(1);
      expect(rows[0].dia).toBe("23/07/2026"); // most recent past Thursday
      expect(rows[0].cotacao).toBe("1234"); // never leaks into cotação/bairro
      expect(rows[0].bairro).toBe("Pituba");
    }
  });

  it("does not split a hyphenated weekday into a fake Nome/Bairro row (regression)", () => {
    const { rows, skipped } = parseConversation("Segunda-feira", TODAY);
    expect(rows).toEqual([]);
    expect(skipped).toEqual([]);
  });

  it("tolerates OCR noise around a weekday marker", () => {
    const leading = parseConversation("D Quinta feira\n1234- Pituba", TODAY);
    expect(leading.rows[0].dia).toBe("23/07/2026");

    const trailing = parseConversation("Quinta feira 16:51\n1234- Pituba", TODAY);
    expect(trailing.rows[0].dia).toBe("23/07/2026");
  });

  it("extracts weekday and period from the same compound marker line", () => {
    const text = `sábado

João Silva
Sábado noite
1234- Pituba
5678- Ondina
domingo
9999- Barra`;
    const { rows } = parseConversation(text, TODAY);
    expect(rows[0]).toMatchObject({ dia: "25/07/2026", periodo: "Noite", cotacao: "1234" });
    expect(rows[1]).toMatchObject({ dia: "25/07/2026", periodo: "Noite", cotacao: "5678" });
    // "domingo" alone updates only the date; period carries over from before.
    expect(rows[2]).toMatchObject({ dia: "26/07/2026", periodo: "Noite", cotacao: "9999" });
  });
});

describe("parseConversation — phone column", () => {
  it("extracts a delivery contact's phone and applies it until a new one appears", () => {
    const text = `-Deus É Fiel O +557199363-4285
MANHÃ
1234- Pituba
Josias Cardoso Quantso
NOITE
5678- Ondina`;
    const { rows } = parseConversation(text, TODAY);
    expect(rows[0].telefone).toBe("+55 71 99363-4285");
    // Sender line with no visible phone blanks the column instead of carrying
    // over the previous (unrelated) contact's number.
    expect(rows[1].telefone).toBe("");
  });
});

describe("parseConversation — Pedido sem nota", () => {
  it("produces a row with cotação = 'Sem nota' and no leading number", () => {
    const { rows } = parseConversation("Pedido sem nota- Patamares\nSem notar: Pituba", TODAY);
    expect(rows).toEqual([
      { periodo: "—", cotacao: "Sem nota", bairro: "Patamares", telefone: "", dia: "" },
      { periodo: "—", cotacao: "Sem nota", bairro: "Pituba", telefone: "", dia: "" },
    ]);
  });
});

describe("parseConversation — real messy OCR transcript", () => {
  it("recovers data rows despite OCR noise (icons, timestamps, mixed contacts)", () => {
    const text = `quarta-feira

-Deus É Fiel O +557199363-4285
MANHÃ
D 2665- Candeal 16:51
Josias Cardoso Quantso
NOITE
1 6750- Pituba sãos
quinta-feira

-Deus É Fiel O +557199363-4285
MANHÃ
5356- Caixa d'água
2090- Pituba
[D) Sem notar : Pituacu 15:56
Josias Cardoso Quantso
NOITE
ga 9864- Pituba
a 4993- Rio Vermelho 55.42


sexta-feira

Josias Cardoso Quantso
MANHÃ
0799- Barra
Pedido sem nota- Patamares
Pedido sem nota- Bairro da Paz
0310- Pituba
0296- Pituba
5153- Pituba
NOITE
1767- Horto Florestal
3759- Pituba
0371- Itaigara
3229- Cidade Jardim
8152- Cidade Jardim
7337- Armação
0916- Pituba
R. 4557- Reenvio
g 9279- Patamares Rida
sábado

Wiliam Quantso
Sexta noite
4557 - Pituba

a 2278 - horto florestal

] 2672 - Rio vermelho 59» M

+ Q 9


Josias Cardoso Quantso
MANHÃ
4135- Pituba
9927- Pituaçu
6258- Pituba
1150- Horto Florestal
2836- Horto Florestal
NOITE
2043- Caminho das Árvores
6771- Pituba
3207- Pituba
9284- Itaigara
3721- Itaigara
1828- Ondina
4508- Pituba
8220- Horto Florestal
a 5589- Pituba
1] 3259- Caminho das Árvores 55.13


Ontem
Josias Cardoso Quantso
MANHÃ
8369- Pituba
6252- Pituba
9553- Pituba
3318- Luiz Anselmo
8362- Pituba
7620- Pituba
9643- Pituba
4317- Horto Florestal
NOITE
8282- Pituba
4811- Vitória
7870- Imbuí
8543- Itaigara
E 5301- Horto Bela Vista
1] 8331- Pituba 221


-Deus É Fiel GB  +557199363-4285
MANHÃ
3634- Paralela
4550- Itaigara
1803- Alto do itaigara
5045- Caminho da arvore
Sem notar: Pituba
4139- Pituba
NOITE
6805- Pituba
9882- Pituba
3823- Graça
1871- Pituba
Sem notar: Pituba
7261- Pituba
4332- Pituba
2856- Horto Florestal
Sem notar: Pituba
7209- Pituba

[D) 1643- Pituba 22:22
Wiliam Quantso
Sábado noite

e 1456 - Pituba

E 2783 - Pituba 55:03

+
`;
    const { rows, skipped } = parseConversation(text, TODAY);
    expect(rows.length).toBe(73);
    expect(skipped.length).toBe(2);
    expect(rows[0]).toMatchObject({ dia: "22/07/2026", periodo: "Manhã", cotacao: "2665", bairro: "Candeal" });
    expect(rows[0].telefone).toBe("+55 71 99363-4285");
  });
});
