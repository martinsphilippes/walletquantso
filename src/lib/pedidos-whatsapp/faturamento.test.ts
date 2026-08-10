import { describe, it, expect } from "vitest";
import { computeFaturamento } from "./faturamento";
import { parseConversation, type ParsedRow } from "./parser";
import type { Client } from "@/types";

function client(p: Partial<Client>): Client {
  return { ownerId: "u1", name: "Pizzaria", createdAt: 0, ...p };
}

function row(p: Partial<ParsedRow>): ParsedRow {
  return { periodo: "—", cotacao: "0001", bairro: "Centro", telefone: "", dia: "06/08/2026", ...p };
}

describe("computeFaturamento", () => {
  const c = client({
    dailyRate: 90,
    zones: [
      { id: "z1", name: "Pituba", price: 10 },
      { id: "z2", name: "Rio Vermelho", price: 12.5 },
    ],
  });

  it("precifica entregas pela tabela de bairros (sem acento/caixa) e lista as sem preço", () => {
    const rows = [
      row({ bairro: "Pituba" }),
      row({ bairro: "pituba" }),
      row({ bairro: "Rio vermelho" }),
      row({ bairro: "Ondina" }),
    ];
    const f = computeFaturamento(c, rows);
    expect(f.entregas).toBe(4);
    expect(f.entregasValor).toBe(32.5); // 10 + 10 + 12,50
    expect(f.semPreco).toEqual([{ bairro: "Ondina", count: 1 }]);
  });

  it("conta diárias como turnos distintos de Dia × Período", () => {
    const rows = [
      row({ dia: "01/08/2026", periodo: "Noite" }),
      row({ dia: "01/08/2026", periodo: "Noite" }),
      row({ dia: "02/08/2026", periodo: "Noite" }),
      row({ dia: "03/08/2026", periodo: "Noite" }),
    ];
    const f = computeFaturamento(c, rows);
    expect(f.diariasDetectadas).toBe(3); // 3 dias diferentes, um turno cada
    expect(f.diariasValor).toBe(270);
    expect(f.turnos).toEqual(["Noite × 3"]);
    expect(f.total).toBe(270 + f.entregasValor);
  });

  it("mesmo dia com dois turnos = duas diárias", () => {
    const rows = [
      row({ dia: "01/08/2026", periodo: "Manhã" }),
      row({ dia: "01/08/2026", periodo: "Noite" }),
    ];
    expect(computeFaturamento(c, rows).diariasDetectadas).toBe(2);
  });

  it("conversa real do Th: 23 entregas em 3 dias = 3 diárias", () => {
    // Reconstrução das mensagens reais (Domingo, Sexta-feira 07/08/26 e
    // Sábado) como o OCR as entrega, com horas e divisor de dia do WhatsApp.
    const TEXT = `~Th +55 71 98387-9497
Domingo

* João - Vitória
* Maria - Pituba
* Luis - Cardeal da Silva
* Márcia - Garcia
« Victor - Ondina
* Plinio - Horto florestal
« Ligia - Rio Vermelho
* Liliane - Ondina
* Rubia - Rio vermelho
07:38

~Th +55 71 98387-9497
Sexta-feira 07/08/26

* Paulo - Pituba
* Higor - Federação
* Fabio - Acupe de Brotas
* Lucy - Costa Azul
23:31

sábado

~Th +55 71 98387-9497
Sábado

* Ines - Waldemar falcão
* Helida - Federação
* Raphael - Rio vermelho
* Márcia - Rio vermelho
* Dora - Costa Azul
* Guilherme - Rio vermelho
* Amanda -  Cardeal da Silva
* Regina - Rio vermelho
* Carlos - Vitória
* Roberta - Rio vermelho
23:45
`;
    const parsed = parseConversation(TEXT, new Date(2026, 7, 10));
    expect(parsed.rows).toHaveLength(23);

    const zones = [
      "Vitória", "Pituba", "Cardeal da Silva", "Garcia", "Ondina",
      "Horto florestal", "Rio Vermelho", "Federação", "Acupe de Brotas",
      "Costa Azul", "Waldemar falcão",
    ].map((name, i) => ({ id: `z${i}`, name, price: 5 }));
    const th = client({ name: "Pizzaria", dailyRate: 50, zones });

    const f = computeFaturamento(th, parsed.rows);
    expect(f.entregas).toBe(23);
    expect(f.entregasValor).toBe(115); // 23 × 5
    expect(f.semPreco).toEqual([]);
    expect(f.diariasDetectadas).toBe(3); // Domingo, Sexta 07/08, Sábado
    expect(f.diariasValor).toBe(150);
    expect(f.turnos).toEqual(["Dia × 3"]);
    expect(f.total).toBe(265);
  });

  it("casa bairros com sufixos/ruído do OCR na tabela (tolerante)", () => {
    const zc = client({
      zones: [
        { id: "z1", name: "Itaigara", price: 10 },
        { id: "z2", name: "Candeal", price: 11 },
        { id: "z3", name: "Armação", price: 12 },
        { id: "z4", name: "Pituba", price: 13 },
        { id: "z5", name: "Caminho das Arvores", price: 14 },
      ],
    });
    const rows = [
      row({ bairro: "Itaigara 2310 |" }),
      row({ bairro: "Candeal- reenvio asa" }),
      row({ bairro: "Armação: retorno" }),
      row({ bairro: "Pituba ns" }),
      row({ bairro: 'Caminho da arvore »"' }),
      row({ bairro: "Caminho da arvore" }),
      row({ bairro: "Pituba et" }),
    ];
    const f = computeFaturamento(zc, rows);
    expect(f.semPreco).toEqual([]);
    expect(f.entregasValor).toBe(10 + 11 + 12 + 13 + 14 + 14 + 13);
  });

  it("conta diárias pelas declarações 'Nome - turno' da conversa (semana real)", () => {
    const TEXT = `Terca feira
Deus é fiel - manha
Deus é fiel - noite

Quarta feira
Josias - manha
Josias noite

Quinta feira
Deus e fiel - manha
Josias - Noite

Sexta feira
Josias - Manha
Josias - Noite
Deus e fiel - Noite

Sabado
Deus e fiel - Manha
Josias - Manha
Josias - Noite
Deus e fiel - Noite

Domingo
Erick - noite
deus e fiel - manha
`;
    const parsed = parseConversation(TEXT, new Date(2026, 7, 10));
    expect(parsed.rows).toEqual([]); // nenhuma declaração vira entrega falsa
    expect(parsed.shifts).toHaveLength(15);

    const f = computeFaturamento(c, [], undefined, parsed.shifts);
    expect(f.diariasDetectadas).toBe(15);
    expect(f.diariasValor).toBe(15 * 90);
  });

  it("cabeçalho MANHÃ/NOITE declara a diária do remetente (2 motoboys no mesmo turno = 2)", () => {
    const TEXT = `Domingo

Josias Cardoso Quantso
MANHÃ

0963- Pituba
0452 Pituba

Deus é fiel Quantso
MANHÃ

7735- Jaguaribe

Josias Cardoso Quantso
NOITE

5168- Pituba
`;
    const parsed = parseConversation(TEXT, new Date(2026, 7, 10));
    expect(parsed.rows).toHaveLength(4); // "0452 Pituba" sem traço também conta
    expect(parsed.shifts).toHaveLength(3);

    const f = computeFaturamento(c, parsed.rows, undefined, parsed.shifts);
    expect(f.diariasDetectadas).toBe(3); // Josias manhã + Deus é fiel manhã + Josias noite
  });

  it("aceita override das diárias e ignora diária quando o cliente não cobra", () => {
    const rows = [row({}), row({ dia: "07/08/2026" })];
    expect(computeFaturamento(c, rows, 5).diariasValor).toBe(450);
    const semDiaria = client({ zones: c.zones });
    expect(computeFaturamento(semDiaria, rows).diariasDetectadas).toBe(0);
  });
});
