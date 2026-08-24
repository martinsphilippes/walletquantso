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

describe("parseConversation — regras ensinadas na conversa da Gialla", () => {
  const TODAY = new Date(2026, 7, 11); // terça, 11/08/2026

  it("descarta 'Mensagem apagada' por inteiro (nem entrega, nem não-reconhecida)", () => {
    const text = `Erick Quantso
Sábado
Noite
O Mensagem apagada 92:05
Você apagou esta mensagem
4583- Pituba
`;
    const { rows, skipped } = parseConversation(text, TODAY);
    expect(rows.length).toBe(1);
    expect(skipped).toEqual([]);
  });

  it("reconhece remetente com sobra de OCR no fim ('Wiliam Quantso »')", () => {
    const text = `Wiliam Quantso »
Quinta feira
1234- Pituba
`;
    const { rows, shifts, skipped } = parseConversation(text, TODAY);
    expect(rows.length).toBe(1);
    expect(skipped).toEqual([]);
    expect(shifts.some((s) => s.name.startsWith("Wiliam"))).toBe(true);
  });

  it("quem entrega sem escrever o turno conta uma diária por dia, turno em branco", () => {
    // Wiliam não escreveu manhã nem tarde em nenhum dos dois dias: são 2
    // diárias dele (uma por dia), com o turno em branco.
    const text = `Wiliam Quantso
Quinta feira
1111- Pituba
2222- Brotas
Sexta feira
3333- Pituba
`;
    const { shifts } = parseConversation(text, TODAY);
    const doWiliam = shifts.filter((s) => s.name.startsWith("Wiliam"));
    expect(doWiliam.length).toBe(2);
    expect(doWiliam.every((s) => s.periodo === "—")).toBe(true);
    expect(new Set(doWiliam.map((s) => s.dia)).size).toBe(2);
  });

  it("não duplica a diária de quem declarou o turno e também entregou", () => {
    // Josias escreveu "manhã" (diária declarada, sem entregas no turno) e
    // depois "tarde" com a lista: 2 diárias, nada de implícita a mais.
    const text = `Josias Quantso
Sexta feira
Manhã
Tarde
1111- Pituba
2222- Brotas
`;
    const { shifts } = parseConversation(text, TODAY);
    const doJosias = shifts.filter((s) => s.name.startsWith("Josias"));
    expect(doJosias.length).toBe(2);
    expect(doJosias.map((s) => s.periodo).sort()).toEqual(["Manhã", "Tarde"]);
  });
});

describe("parseConversation — lista colada com _dias_ em itálico e Nome Bairro sem traço", () => {
  const TODAY = new Date(2026, 7, 17); // segunda, 17/08/2026
  const ZONES = [
    "Rio Vermelho", "Barra", "Campo da Pólvora", "Horto Florestal", "Ondina",
    "Jardim Apipema", "Federação", "Pituba", "Dois de Julho",
  ];
  const text = `_Sexta_
Noite
* Henrique - Rio Vermelho 
* Caíque - Barra 
* Yane - Rio Vermelho 
* Andrea - Rio Vermelho 
* Pili - Rio Vermelho

_Sábado_
Noite
* Claudia - Campo da Pólvora 
* Marcus - Barra 
* Claudia - Rio Vermelho 
* Elísio - Rio Vermelho 
* Carol - Rio Vermelho 
* Luiz - Horto florestal 
* Ana Cecília - Rio Vermelho 
* Tatiana - Rio Vermelho 
* Rodrigo - Rio Vermelho 
* Bruna - Rio Vermelho
Domingo
Noite
Claudia rio vermelho 
Henrique rio vermelho
Caíque Barra 
Bernardo ondina
Patrícia jardim apipema
Ana horto florestal 
Luiz federação 
Marta rio vermelho 
Bruno ondina 
Ronaldo ondina 
Arlei Pituba 
Mariana dois de julho 
Alex rio vermelho 
Maia rio vermelho 
`;

  it("29 entregas, dias de sexta/sábado/domingo resolvidos, nada ignorado", () => {
    const { rows, skipped } = parseConversation(text, TODAY, { zoneNames: ZONES });
    expect(rows.length).toBe(29);
    expect(skipped).toEqual([]);
    const dias = new Set(rows.map((r) => r.dia));
    expect(dias).toEqual(new Set(["14/08/2026", "15/08/2026", "16/08/2026"]));
    expect(rows.every((r) => r.periodo === "Noite")).toBe(true);
  });

  it("linhas sem traço viram entregas pela tabela de bairros (não remetentes)", () => {
    const { rows } = parseConversation(text, TODAY, { zoneNames: ZONES });
    const domingo = rows.filter((r) => r.dia === "16/08/2026");
    expect(domingo.length).toBe(14);
    expect(domingo.find((r) => r.cotacao === "Mariana")?.bairro).toBe("dois de julho");
    expect(domingo.find((r) => r.cotacao === "Patrícia")?.bairro).toBe("jardim apipema");
  });

  it("3 diárias: uma por dia, turno Noite", () => {
    const { shifts } = parseConversation(text, TODAY, { zoneNames: ZONES });
    const dedup = new Set(shifts.map((s) => `${s.dia}|${s.periodo.toLowerCase()}|${s.name.toLowerCase()}`));
    expect(dedup.size).toBe(3);
    expect(shifts.every((s) => s.periodo === "Noite")).toBe(true);
  });
});

describe("parseConversation — lista colada: bairro fora da tabela e texto extra no fim", () => {
  const TODAY = new Date(2026, 7, 19);
  // Tabela SEM "Ondina": as linhas "Bernardo ondina" etc. ainda são entregas
  // (aparecem como "sem preço"), e a diária do dia continua sendo UMA (a do
  // marcador "Noite"), sem diária fantasma de falso remetente.
  const ZONES = ["Rio Vermelho", "Barra", "Pituba", "Dois de Julho", "Jardim Apipema", "Federação", "Horto Florestal"];
  const text = `Domingo
Noite
Claudia rio vermelho 
Caíque Barra 
Bernardo ondina
Patrícia jardim apipema
Bruno ondina 
Ronaldo ondina 
Arlei Pituba 

Aqui sao: 
3 diarias (sexta, sábado e domingo)
Turno Noite de todas as diarias
29 entregas realizadas 
`;

  it("linha vizinha com bairro desconhecido vira entrega (não some como remetente)", () => {
    const { rows } = parseConversation(text, TODAY, { zoneNames: ZONES });
    expect(rows.length).toBe(7);
    expect(rows.filter((r) => r.bairro === "ondina").length).toBe(3);
  });

  it("dia com diária anônima declarada não ganha diária implícita por cima", () => {
    const { shifts } = parseConversation(text, TODAY, { zoneNames: ZONES });
    const dedup = new Set(shifts.map((s) => `${s.dia}|${s.periodo.toLowerCase()}|${s.name.toLowerCase()}`));
    expect(dedup.size).toBe(1);
  });

  it("o bloco de descrição no fim não vira entrega nem diária", () => {
    const { rows, shifts } = parseConversation(text, TODAY, { zoneNames: ZONES });
    expect(rows.some((r) => /diaria|entrega|aqui/i.test(r.bairro + r.cotacao))).toBe(false);
    expect(shifts.length).toBe(1);
  });
});

describe("parseConversation — dia com data sem ano: 'Sabado (22/08)'", () => {
  const TODAY = new Date(2026, 7, 24); // segunda, 24/08/2026

  it("resolve 'Sabado (22/08)' e 'Domingo (23/08)' como dias, sem linha ignorada", () => {
    const text = `Sexta - Feira (21/08)
* Henrique - Rio Vermelho
Sabado (22/08)
* Mário - Rio Vermelho
Domingo (23/08)
* David - Pituba
`;
    const { rows, skipped } = parseConversation(text, TODAY);
    expect(skipped).toEqual([]);
    expect(rows.length).toBe(3);
    expect(rows.map((r) => r.dia)).toEqual(["21/08/2026", "22/08/2026", "23/08/2026"]);
  });

  it("'Sexta - Feira (21/08)' é marcador de dia, não entrega fantasma 'Feira (21/08)'", () => {
    const { rows } = parseConversation("Sexta - Feira (21/08)\n1234- Pituba\n", TODAY);
    expect(rows.length).toBe(1);
    expect(rows[0].bairro).toBe("Pituba");
    expect(rows[0].dia).toBe("21/08/2026");
  });

  it("data sem ano que cairia no futuro pertence ao ano anterior", () => {
    const jan = new Date(2027, 0, 5); // 05/01/2027
    const { rows } = parseConversation("Sabado (28/12)\n1234- Pituba\n", jan);
    expect(rows[0].dia).toBe("28/12/2026");
  });
});
