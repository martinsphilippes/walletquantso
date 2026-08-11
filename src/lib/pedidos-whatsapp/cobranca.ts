// WalletQuantso — documento de cobrança para o cliente (Pedidos WhatsApp).
//
// Gera a planilha de prestação de contas no formato que o negócio sempre
// enviou: lista de todas as entregas (cotação, bairro, dia, turno, valor),
// lista dos motoboys e seus turnos (diárias), totais de cada parte, o total
// a pagar, o período trabalhado e a tabela de preços por bairro para
// conferência. O montador de células é puro (testável); o download usa o
// xlsx já existente no projeto.

import * as XLSX from "xlsx";
import type { Client } from "@/types";
import type { ParsedRow, ShiftRow } from "./parser";
import {
  dedupeShifts,
  summarizeRows,
  zonePriceFor,
  type FaturamentoResult,
} from "./faturamento";

type Cell = string | number;

const dateKey = (d: string) => d.split("/").reverse().join("-");

/** Monta as células do documento (matriz linha × coluna). */
export function buildCobrancaAoa(
  client: Client,
  rows: ParsedRow[],
  shifts: ShiftRow[],
  fat: FaturamentoResult,
  now: Date = new Date(),
): Cell[][] {
  const s = summarizeRows(rows);
  const geradoEm = now.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const aoa: Cell[][] = [];
  aoa.push([`COBRANÇA — ${client.name}`]);
  aoa.push([`Período trabalhado: ${s.period ?? "—"}`]);
  aoa.push([`Gerado em: ${geradoEm}`]);
  aoa.push([]);

  // ── Resumo primeiro: quem paga vê logo o que importa ─────────────────────
  aoa.push(["RESUMO"]);
  aoa.push(["Diárias", fat.diarias, "", "", fat.diariasValor]);
  aoa.push(["Entregas", fat.entregas, "", "", fat.entregasValor]);
  if (fat.revenueValor > 0) {
    aoa.push([
      `% do faturamento (${String(client.revenuePercent).replace(".", ",")}% sobre ${fat.revenueBase})`,
      "",
      "",
      "",
      fat.revenueValor,
    ]);
  }
  aoa.push(["TOTAL A PAGAR", "", "", "", fat.total]);
  aoa.push([]);

  // ── Entregas, em ordem cronológica ────────────────────────────────────────
  aoa.push(["ENTREGAS"]);
  aoa.push(["Cotação", "Bairro", "Dia", "Turno", "Valor (R$)"]);
  const ordered = [...rows].sort((a, b) =>
    dateKey(a.dia || "99/99/9999").localeCompare(dateKey(b.dia || "99/99/9999")),
  );
  for (const r of ordered) {
    const price = r.bairro ? zonePriceFor(client, r.bairro) : null;
    aoa.push([
      r.cotacao,
      r.bairro,
      r.dia || "—",
      r.periodo === "—" ? "" : r.periodo,
      price ?? "sem preço",
    ]);
  }
  aoa.push(["Total de entregas", fat.entregas, "", "", fat.entregasValor]);
  aoa.push([]);

  // ── Diárias / motoboys ───────────────────────────────────────────────────
  aoa.push(["DIÁRIAS (MOTOBOYS)"]);
  const declared = dedupeShifts(shifts);
  if (declared.length > 0) {
    aoa.push(["Motoboy", "Dia", "Turno", "", "Valor (R$)"]);
    const orderedShifts = [...declared].sort((a, b) =>
      dateKey(a.dia || "99/99/9999").localeCompare(dateKey(b.dia || "99/99/9999")),
    );
    for (const sh of orderedShifts) {
      aoa.push([sh.name || "—", sh.dia || "—", sh.periodo, "", client.dailyRate ?? 0]);
    }
  } else if (fat.diarias > 0) {
    aoa.push([`Diárias consideradas: ${fat.turnos.join(", ")}`]);
  }
  if (declared.length > 0 && fat.diarias !== declared.length) {
    aoa.push([`Quantidade ajustada manualmente para ${fat.diarias} diária(s).`]);
  }
  aoa.push(["Total de diárias", fat.diarias, "", "", fat.diariasValor]);
  aoa.push([]);

  // ── Tabela de preços para conferência ────────────────────────────────────
  aoa.push(["TABELA DE PREÇOS POR BAIRRO"]);
  aoa.push(["Bairro", "", "", "", "Valor (R$)"]);
  const zones = [...(client.zones ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR"),
  );
  for (const z of zones) aoa.push([z.name, "", "", "", z.price]);
  if ((client.dailyRate ?? 0) > 0) {
    aoa.push(["Diária (um motoboy por turno)", "", "", "", client.dailyRate as number]);
  }

  return aoa;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function cobrancaFilename(client: Client, now: Date = new Date()): string {
  const slug = client.name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `cobranca_${slug}_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.xlsx`;
}

/** Gera e baixa o .xlsx do documento de cobrança. */
export function downloadCobranca(
  client: Client,
  rows: ParsedRow[],
  shifts: ShiftRow[],
  fat: FaturamentoResult,
): void {
  const ws = XLSX.utils.aoa_to_sheet(buildCobrancaAoa(client, rows, shifts, fat));
  ws["!cols"] = [{ wch: 34 }, { wch: 24 }, { wch: 14 }, { wch: 10 }, { wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Cobrança");
  XLSX.writeFile(wb, cobrancaFilename(client));
}
