// WalletQuantso — persistência da preferência de período (chips de filtro).
//
// A última escolha do usuário fica gravada no navegador. Presets são salvos
// pelo NOME (não pelas datas), então "Este mês" reabre sempre no mês corrente;
// datas digitadas à mão são salvas como "custom" com os valores exatos.
//
// Exceção importante: uma data final igual ao dia de hoje significa "até
// hoje", não "até este dia fixo". Sem isso, mexer só na data inicial (com a
// final vinda de um preset "até hoje") congelava a final no dia da edição, e
// no dia seguinte os lançamentos novos sumiam da lista.

import { monthRangeBr, daysAgoBr, todayBr, currentMonthBr } from "@/lib/br/date";

export interface PeriodChoice {
  preset: string;
  from?: string;
  to?: string;
  /** A data final era "hoje" quando foi salva: segue o calendário. */
  toToday?: boolean;
}

/** Datas de um preset, calculadas no momento da leitura (fuso do Brasil). */
export function presetRange(preset: string): { from: string; to: string } | null {
  switch (preset) {
    case "all":
      return { from: "", to: "" };
    case "month0":
      return monthRangeBr(0);
    case "month-1":
      return monthRangeBr(-1);
    case "month+1":
      return monthRangeBr(1);
    case "days30":
      return { from: daysAgoBr(30), to: todayBr() };
    case "days60":
      return { from: daysAgoBr(60), to: todayBr() };
    case "days90":
      return { from: daysAgoBr(90), to: todayBr() };
    case "thisMonthToToday":
      return { from: `${currentMonthBr()}-01`, to: todayBr() };
    default:
      return null;
  }
}

/** O que gravar para um período digitado à mão (lógica pura, testável). */
export function encodeCustomPeriod(from: string, to: string, today: string): PeriodChoice {
  return { preset: "custom", from, to, toToday: !!to && to === today };
}

/** Datas de uma escolha salva, lida em `today` (lógica pura, testável). */
export function decodePeriod(saved: PeriodChoice, today: string): { from: string; to: string } | null {
  if (saved.preset === "custom") {
    const to = saved.toToday ? today : (saved.to ?? "");
    const from = saved.from ?? "";
    // Se a final acompanhou o calendário e ficou antes da inicial, abre o fim.
    return { from, to: from && to && to < from ? "" : to };
  }
  return presetRange(saved.preset);
}

/** Última escolha salva, já convertida em datas. null = nada salvo. */
export function loadPeriod(key: string): { from: string; to: string } | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return decodePeriod(JSON.parse(raw) as PeriodChoice, todayBr());
  } catch {
    return null;
  }
}

export function savePreset(key: string, preset: string): void {
  try {
    localStorage.setItem(key, JSON.stringify({ preset }));
  } catch {
    /* ignore */
  }
}

export function saveCustomPeriod(key: string, from: string, to: string): void {
  try {
    localStorage.setItem(key, JSON.stringify(encodeCustomPeriod(from, to, todayBr())));
  } catch {
    /* ignore */
  }
}
