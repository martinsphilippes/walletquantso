// WalletQuantso — persistência da preferência de período (chips de filtro).
//
// A última escolha do usuário fica gravada no navegador. Presets são salvos
// pelo NOME (não pelas datas), então "Este mês" reabre sempre no mês corrente;
// datas digitadas à mão são salvas como "custom" com os valores exatos.

import { monthRangeBr, daysAgoBr, todayBr, currentMonthBr } from "@/lib/br/date";

export interface PeriodChoice {
  preset: string;
  from?: string;
  to?: string;
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

/** Última escolha salva, já convertida em datas. null = nada salvo. */
export function loadPeriod(key: string): { from: string; to: string } | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const saved = JSON.parse(raw) as PeriodChoice;
    if (saved.preset === "custom") return { from: saved.from ?? "", to: saved.to ?? "" };
    return presetRange(saved.preset);
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
    localStorage.setItem(key, JSON.stringify({ preset: "custom", from, to }));
  } catch {
    /* ignore */
  }
}
