// WalletQuantso — documento de cobrança em PDF (Pedidos WhatsApp).
//
// Versão apresentável do documento de cobrança, com a identidade Quantso:
// faixa de cabeçalho com a logomarca, cartões de resumo logo no topo
// (Diárias · Entregas · TOTAL A PAGAR), tabelas detalhadas, tabela de preços
// para conferência e marca d'água da Quantso em todas as páginas. As
// bibliotecas de PDF são importadas sob demanda (não pesam o carregamento
// da página).

import type { Client } from "@/types";
import type { ParsedRow, ShiftRow } from "./parser";
import {
  dedupeShifts,
  summarizeRows,
  zonePriceFor,
  type FaturamentoResult,
} from "./faturamento";
import { cobrancaFilename } from "./cobranca";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const dateKey = (d: string) => d.split("/").reverse().join("-");

async function logoDataUrl(): Promise<string | null> {
  try {
    const res = await fetch("/quantso-logo.jpg");
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function downloadCobrancaPdf(
  client: Client,
  rows: ParsedRow[],
  shifts: ShiftRow[],
  fat: FaturamentoResult,
): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const logo = await logoDataUrl();

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 40;

  const ink: [number, number, number] = [17, 18, 20];
  const gray: [number, number, number] = [120, 124, 130];
  const line: [number, number, number] = [225, 227, 230];
  const soft: [number, number, number] = [248, 249, 250];

  const s = summarizeRows(rows);
  const geradoEm = new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  // ── Cabeçalho (página 1) ──────────────────────────────────────────────────
  doc.setFillColor(...ink);
  doc.rect(0, 0, W, 86, "F");
  if (logo) doc.addImage(logo, "JPEG", M, 18, 50, 50);
  const hx = M + (logo ? 64 : 0);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Documento de Cobrança", hx, 42);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(190, 192, 196);
  doc.text("WalletQuantso · Quantso", hx, 60);
  doc.text(`Gerado em ${geradoEm}`, W - M, 42, { align: "right" });

  doc.setTextColor(...ink);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(client.name, M, 116);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...gray);
  doc.text(`Período trabalhado: ${s.period ?? "—"}`, M, 132);

  // ── Cartões de resumo: quem paga vê primeiro o que importa ───────────────
  const cardY = 150;
  const cardH = 66;
  const gap = 12;

  interface CardSpec {
    label: string;
    value: string;
    sub: string;
    filled: boolean;
  }
  const cards: CardSpec[] = [];
  if ((client.dailyRate ?? 0) > 0 || fat.diariasValor > 0) {
    cards.push({
      label: "Diárias",
      value: brl(fat.diariasValor),
      sub: `${fat.diarias} diária(s)`,
      filled: false,
    });
  }
  if ((client.zones?.length ?? 0) > 0 || fat.entregas > 0) {
    cards.push({
      label: "Entregas",
      value: brl(fat.entregasValor),
      sub: `${fat.entregas} entrega(s)`,
      filled: false,
    });
  }
  if (fat.revenueValor > 0) {
    const nLojas =
      fat.revenueParts && fat.revenueParts.length > 1
        ? ` · ${fat.revenueParts.length} lojas`
        : "";
    cards.push({
      label: "% do faturamento",
      value: brl(fat.revenueValor),
      sub: `${String(client.revenuePercent).replace(".", ",")}% de ${brl(fat.revenueBase ?? 0)}${nLojas}`,
      filled: false,
    });
  }
  cards.push({ label: "Total a pagar", value: brl(fat.total), sub: "soma de tudo", filled: true });

  const cardW = (W - 2 * M - (cards.length - 1) * gap) / cards.length;

  const card = (x: number, c: CardSpec) => {
    if (c.filled) {
      doc.setFillColor(...ink);
      doc.roundedRect(x, cardY, cardW, cardH, 6, 6, "F");
    } else {
      doc.setDrawColor(...line);
      doc.setLineWidth(1);
      doc.setFillColor(...soft);
      doc.roundedRect(x, cardY, cardW, cardH, 6, 6, "FD");
    }
    const muted: [number, number, number] = [190, 192, 196];
    const white: [number, number, number] = [255, 255, 255];
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...(c.filled ? muted : gray));
    doc.text(c.label.toUpperCase(), x + 12, cardY + 18);
    doc.setFontSize(cards.length > 3 ? 13 : 15);
    doc.setTextColor(...(c.filled ? white : ink));
    doc.text(c.value, x + 12, cardY + 40);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...(c.filled ? muted : gray));
    doc.text(c.sub, x + 12, cardY + 55);
  };

  cards.forEach((c, i) => card(M + i * (cardW + gap), c));

  // ── Tabelas ──────────────────────────────────────────────────────────────
  const tableStyles = {
    styles: {
      fontSize: 8.5,
      textColor: [40, 42, 46] as [number, number, number],
      lineColor: line,
      lineWidth: 0.4,
      cellPadding: 4,
    },
    headStyles: { fillColor: ink, textColor: 255, fontStyle: "bold" as const },
    footStyles: {
      fillColor: [238, 239, 241] as [number, number, number],
      textColor: ink,
      fontStyle: "bold" as const,
    },
    alternateRowStyles: { fillColor: soft },
    margin: { left: M, right: M, top: 60, bottom: 60 },
  };

  const section = (title: string, y: number): number => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...ink);
    doc.text(title, M, y);
    return y + 8;
  };

  let y = cardY + cardH + 34;
  const afterTable = () => {
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 28;
    if (y > H - 160) {
      doc.addPage();
      y = 70;
    }
  };

  if (rows.length > 0) {
    y = section("ENTREGAS", y);
    const ordered = [...rows].sort((a, b) =>
      dateKey(a.dia || "99/99/9999").localeCompare(dateKey(b.dia || "99/99/9999")),
    );
    autoTable(doc, {
      ...tableStyles,
      startY: y,
      head: [["Cotação", "Bairro", "Dia", "Turno", "Valor"]],
      body: ordered.map((r) => {
        const price = r.bairro ? zonePriceFor(client, r.bairro) : null;
        return [
          r.cotacao,
          r.bairro,
          r.dia || "—",
          r.periodo === "—" ? "" : r.periodo,
          price != null ? brl(price) : "sem preço",
        ];
      }),
      foot: [[`Total: ${fat.entregas} entrega(s)`, "", "", "", brl(fat.entregasValor)]],
      columnStyles: { 4: { halign: "right" } },
    });
    afterTable();
  }

  const declared = dedupeShifts(shifts).sort((a, b) =>
    dateKey(a.dia || "99/99/9999").localeCompare(dateKey(b.dia || "99/99/9999")),
  );
  if (declared.length > 0 || fat.diarias > 0) {
    y = section("DIÁRIAS (MOTOBOYS)", y);
    const diariasBody =
      declared.length > 0
        ? declared.map((sh) => [
            sh.name || "—",
            sh.dia || "—",
            sh.periodo,
            brl(client.dailyRate ?? 0),
          ])
        : [[`Diárias consideradas: ${fat.turnos.join(", ") || fat.diarias}`, "", "", ""]];
    const diariasFoot: string[][] = [
      [`Total: ${fat.diarias} diária(s)`, "", "", brl(fat.diariasValor)],
    ];
    if (declared.length > 0 && fat.diarias !== fat.diariasDetectadas) {
      diariasBody.push([`Quantidade ajustada manualmente para ${fat.diarias}.`, "", "", ""]);
    }
    autoTable(doc, {
      ...tableStyles,
      startY: y,
      head: [["Motoboy", "Dia", "Turno", "Valor"]],
      body: diariasBody,
      foot: diariasFoot,
      columnStyles: { 3: { halign: "right" } },
    });
    afterTable();
  }

  // Faturamento dividido por loja/canal (base do percentual).
  if (fat.revenueValor > 0 && fat.revenueParts && fat.revenueParts.length > 0) {
    y = section("FATURAMENTO POR LOJA/CANAL", y);
    const pctLabel = String(client.revenuePercent).replace(".", ",");
    autoTable(doc, {
      ...tableStyles,
      startY: y,
      head: [["Loja/Canal", "Faturamento"]],
      body: fat.revenueParts.map((p) => [p.label, brl(p.value)]),
      foot: [
        [`Total × ${pctLabel}% = ${brl(fat.revenueValor)}`, brl(fat.revenueBase ?? 0)],
      ],
      columnStyles: { 1: { halign: "right" } },
      tableWidth: (W - 2 * M) / 2,
    });
    afterTable();
  }

  // Tabela de preços do mais barato para o mais caro (empate: ordem alfabética).
  const zones = [...(client.zones ?? [])].sort(
    (a, b) => a.price - b.price || a.name.localeCompare(b.name, "pt-BR"),
  );
  if (zones.length > 0 || (client.dailyRate ?? 0) > 0) {
    y = section("TABELA DE PREÇOS POR BAIRRO (para conferência)", y);
    const priceBody: string[][] = zones.map((z) => [z.name, brl(z.price)]);
    if ((client.dailyRate ?? 0) > 0) {
      priceBody.push(["Diária (um motoboy por turno)", brl(client.dailyRate as number)]);
    }
    autoTable(doc, {
      ...tableStyles,
      startY: y,
      head: [["Bairro", "Valor"]],
      body: priceBody,
      columnStyles: { 1: { halign: "right" } },
      tableWidth: (W - 2 * M) / 2,
    });
  }

  // ── Marca d'água + rodapé em todas as páginas ────────────────────────────
  const pages = doc.getNumberOfPages();
  type WithGState = typeof doc & {
    GState: new (o: { opacity: number }) => unknown;
    setGState: (g: unknown) => void;
  };
  const d = doc as WithGState;
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.saveGraphicsState();
    d.setGState(new d.GState({ opacity: 0.05 }));
    if (logo) doc.addImage(logo, "JPEG", W / 2 - 130, H / 2 - 130, 260, 260);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(42);
    doc.setTextColor(60, 60, 60);
    doc.text("QUANTSO", W / 2, H - 110, { align: "center", angle: 30 });
    doc.restoreGraphicsState();

    doc.setDrawColor(...line);
    doc.setLineWidth(0.7);
    doc.line(M, H - 46, W - M, H - 46);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...gray);
    doc.text("Documento gerado pelo WalletQuantso — sistema Quantso", M, H - 32);
    doc.text(`Página ${i} de ${pages}`, W - M, H - 32, { align: "right" });
  }

  doc.save(cobrancaFilename(client).replace(/\.xlsx$/, ".pdf"));
}
