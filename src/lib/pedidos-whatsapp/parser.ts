// Parses a WhatsApp conversation (pasted text, or OCR output from a
// screenshot/photo) into rows of {Manhã/Tarde, Cotação, Bairro, Telefone,
// Dia}. Ported from the standalone Dia-Dia tool (github.com/martinsphilippes/
// Dia-Dia), tuned against real, messy OCR transcripts from the business.
//
// Recognized line shapes:
//   *MANHÃ* / *NOITE* / *TARDE*        -- asterisk-wrapped period header
//   MANHÃ / NOITE (bare, anywhere)     -- period marker, also inline e.g. "Sábado noite"
//   segunda-feira / segunda feira /
//   segunda - feira / sábado / ontem   -- day marker -> resolved to an actual date
//   0000- Bairro                       -- numeric cotação line
//   Nome - Bairro                      -- name-based cotação line
//   Pedido sem nota- Bairro            -- no-cotação line
//   a phone number on its own line     -- delivery contact's phone, applies
//                                          to subsequent rows until a new one

export interface ParsedRow {
  periodo: string;
  cotacao: string;
  bairro: string;
  telefone: string;
  dia: string;
}

/** Declaração de diária: "Nome - manhã" / "Nome noite" — motoboy num turno. */
export interface ShiftRow {
  name: string;
  periodo: string;
  dia: string;
}

export interface ParseResult {
  rows: ParsedRow[];
  /** Diárias declaradas na conversa (nome do entregador + turno + dia). */
  shifts: ShiftRow[];
  skipped: string[];
}

export const COLUMNS = ["Manhã/Tarde", "Cotação", "Bairro", "Telefone", "Dia"] as const;

export function rowValues(r: ParsedRow): string[] {
  return [r.periodo, r.cotacao, r.bairro, r.telefone, r.dia];
}

// OCR/WhatsApp produce many dash lookalikes (‐ ‑ ‒ – — ― − ﹘ －). Everything
// is normalized to a plain "-" before matching, so "Nome − Bairro" lines from
// a photo parse the same as typed ones.
const DASH_VARIANTS = /[‐-―−﹘－]/g;
// An explicit date in a marker line ("Sexta-feira 07/08/26") wins over the
// weekday resolution.
const EXPLICIT_DATE = /\b(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})\b/;

const PERIOD_WORD = /(manh[aã]|tarde|noite|madrugada)/i;
const HEADER_LINE = /^\*+\s*(.+?)\s*\*+$/;
const LETTER = "A-Za-zÀ-ÖØ-öø-ÿ";
// Tolerates a short OCR-noise token (misread icon/checkmark) before the digits, e.g. "D 2665- Candeal".
const DATA_LINE = /^(?:\S{1,3}\s+)?(\d{2,6})\s*[-–—]\s*(.+)$/;
const NAME_LINE = new RegExp(
  "^[^" + LETTER + "]*([" + LETTER + "][" + LETTER + "'.]*(?:\\s+[" + LETTER + "][" + LETTER + "'.]*)*)\\s*[-–—]\\s*(.+)$",
);
const SEM_NOTA_LINE = /^(?:\S{1,3}\s+)?(?:pedido\s+)?sem\s+notar?\s*[:\-]\s*(.+)$/i;
const PHONE_PATTERN = /\+?\d[\d\s-]{8,14}\d/;
const NAME_ONLY_LINE = new RegExp("^[A-ZÀ-Ö][a-zà-öø-ÿ'.]*(?:\\s+[A-ZÀ-Ö][a-zà-öø-ÿ'.]*){1,4}$");
const TRAILING_NOISE = /\s*[[\]()]*\s*\d{1,2}[:.]\d{2}\s*[»>]?\s*[A-Za-z]?\s*$/;

// "feira" days: the stem alone ("quinta"), or the stem plus "feira" with any
// amount of spaces and/or a hyphen between them ("quinta-feira", "quinta
// feira", "quinta - feira", "quintafeira") all resolve the same.
const WEEKDAY_STEMS: { stem: string; dow: number; feira: boolean }[] = [
  { stem: "domingo", dow: 0, feira: false },
  { stem: "segunda", dow: 1, feira: true },
  { stem: "terca", dow: 2, feira: true },
  { stem: "quarta", dow: 3, feira: true },
  { stem: "quinta", dow: 4, feira: true },
  { stem: "sexta", dow: 5, feira: true },
  { stem: "sabado", dow: 6, feira: false },
];

function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w.length ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function normalizeAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDateBR(d: Date): string {
  return pad2(d.getDate()) + "/" + pad2(d.getMonth() + 1) + "/" + d.getFullYear();
}

function mostRecentPastWeekday(targetDow: number, today: Date): Date {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let diff = (d.getDay() - targetDow + 7) % 7;
  if (diff === 0) diff = 7;
  d.setDate(d.getDate() - diff);
  return d;
}

function weekdayRegex(stem: string, feira: boolean): RegExp {
  const pattern = feira ? "\\b" + stem + "\\b(?:\\s*-?\\s*feira\\b)?" : "\\b" + stem + "\\b";
  return new RegExp(pattern);
}

function findWeekdayMatch(normalized: string): { dow: number; matchText: string } | null {
  for (const w of WEEKDAY_STEMS) {
    const m = normalized.match(weekdayRegex(w.stem, w.feira));
    if (m) return { dow: w.dow, matchText: m[0] };
  }
  return null;
}

function findDateInLine(line: string, today: Date): string | null {
  const normalized = normalizeAccents(line.toLowerCase());
  const explicit = normalized.match(EXPLICIT_DATE);
  if (explicit) {
    const day = Number(explicit[1]);
    const month = Number(explicit[2]);
    let year = Number(explicit[3]);
    if (year < 100) year += 2000;
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return pad2(day) + "/" + pad2(month) + "/" + year;
    }
  }
  const wd = findWeekdayMatch(normalized);
  if (wd) return formatDateBR(mostRecentPastWeekday(wd.dow, today));
  if (/\bontem\b/.test(normalized)) {
    const y = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    return formatDateBR(y);
  }
  if (/\bhoje\b/.test(normalized)) {
    return formatDateBR(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  }
  return null;
}

function findPeriodInLine(line: string): string | null {
  const m = line.match(PERIOD_WORD);
  return m ? toTitleCase(m[1]) : null;
}

/**
 * Detects marker lines that name a day and/or a period (e.g. "sábado",
 * "NOITE", or a combined "Sábado noite"), updating whichever parts are
 * present.
 */
function applyDayAndPeriod(
  line: string,
  today: Date,
  setDate: (d: string) => void,
  setPeriod: (p: string) => void,
): boolean {
  const date = findDateInLine(line, today);
  const period = findPeriodInLine(line);
  if (date) setDate(date);
  if (period) setPeriod(period);
  return Boolean(date || period);
}

/**
 * True when the line is made up of day-of-week/period words -- e.g. "Segunda
 * feira", "Segunda-feira", "sábado", "NOITE", "Sábado noite" -- and little
 * else. Tolerates a bit of leftover OCR noise (a stray misread icon/
 * checkmark) the same way data lines do, so "D Quinta feira" or "Quinta
 * feira 16:51" still count. This lets us treat those safely as markers
 * *before* the Nome/Bairro parser runs, without risking swallowing a real
 * "Nome - Bairro" line that merely contains a period word inside the bairro
 * text (those never match a weekday/period word at all, so they're rejected
 * right away below).
 */
function isPureDayPeriodLine(line: string): boolean {
  const normalized = normalizeAccents(line.toLowerCase()).replace(TRAILING_NOISE, "").trim();
  const wd = findWeekdayMatch(normalized);
  const hasPeriod = PERIOD_WORD.test(normalized);
  const hasRelative = /\bontem\b|\bhoje\b/.test(normalized);
  const hasExplicitDate = EXPLICIT_DATE.test(normalized);
  if (!wd && !hasPeriod && !hasRelative && !hasExplicitDate) return false;

  let remaining = normalized;
  if (wd) remaining = remaining.replace(wd.matchText, " ");
  remaining = remaining.replace(/\bontem\b/, " ").replace(/\bhoje\b/, " ");
  remaining = remaining.replace(PERIOD_WORD, " ");
  // "Sexta-feira 07/08/26": a data explícita faz parte do marcador de dia.
  remaining = remaining.replace(EXPLICIT_DATE, " ");
  remaining = remaining.replace(/[-–—\s]+/g, "");
  return remaining.length <= 3;
}

function stripTrailingNoise(bairro: string): string {
  return bairro.replace(TRAILING_NOISE, "").trim();
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (/^55\d{10,11}$/.test(digits)) {
    const rest = digits.slice(2);
    const area = rest.slice(0, 2);
    const number = rest.slice(2);
    if (number.length === 9) return "+55 " + area + " " + number.slice(0, 5) + "-" + number.slice(5);
    if (number.length === 8) return "+55 " + area + " " + number.slice(0, 4) + "-" + number.slice(4);
  }
  if (digits.length >= 9) return "+" + digits;
  return "";
}

// "Nome - manhã" (o lado direito é SÓ a palavra do turno) ou "Nome noite"
// (sem traço) declaram uma diária, não uma entrega.
const PERIOD_ONLY = /^(manh[aã]|tarde|noite|madrugada)$/i;
const SHIFT_NO_DASH = new RegExp(
  "^([" + LETTER + "][" + LETTER + "'.]*(?:\\s+[" + LETTER + "][" + LETTER + "'.]*){0,4})\\s+(manh[aã]|tarde|noite|madrugada)$",
  "i",
);

function matchShiftLine(line: string): { name: string; periodo: string } | null {
  const m = line.match(NAME_LINE);
  if (m) {
    const rest = stripTrailingNoise(m[2]).trim();
    const pm = rest.match(PERIOD_ONLY);
    if (pm) return { name: m[1].trim(), periodo: toTitleCase(pm[1]) };
    return null;
  }
  const nm = stripTrailingNoise(line).trim().match(SHIFT_NO_DASH);
  if (nm) return { name: nm[1].trim(), periodo: toTitleCase(nm[2]) };
  return null;
}

function matchSenderLine(line: string): { phone: string } | null {
  const stripped = line.replace(/^[^A-Za-zÀ-ÖØ-öø-ÿ+0-9]+/, "").trim();
  if (!stripped) return null;
  const phoneMatch = stripped.match(PHONE_PATTERN);
  if (phoneMatch) {
    const phone = normalizePhone(phoneMatch[0]);
    if (phone) return { phone };
  }
  if (NAME_ONLY_LINE.test(stripped)) return { phone: "" };
  return null;
}

export function parseConversation(text: string, today: Date = new Date()): ParseResult {
  const lines = text.split(/\r?\n/);
  let currentPeriod = "";
  let currentDate = "";
  let currentPhone = "";
  const rows: ParsedRow[] = [];
  const shifts: ShiftRow[] = [];
  const skipped: string[] = [];

  function pushRow(cotacao: string, bairro: string) {
    rows.push({
      periodo: currentPeriod || "—",
      cotacao,
      bairro: stripTrailingNoise(bairro),
      telefone: currentPhone,
      dia: currentDate,
    });
  }

  for (const raw of lines) {
    // Normaliza todas as variantes de traço para "-" antes de reconhecer os
    // formatos (fotos/OCR trazem − ‑ ‒ etc. no lugar do hífen).
    const line = raw.trim().replace(DASH_VARIANTS, "-");
    if (!line) continue;

    const headerMatch = line.match(HEADER_LINE);
    if (headerMatch) {
      const inner = headerMatch[1];
      const consumedHeader = applyDayAndPeriod(
        inner,
        today,
        (d) => (currentDate = d),
        (p) => (currentPeriod = p),
      );
      if (!consumedHeader) currentPeriod = toTitleCase(inner);
      continue;
    }

    const semNotaMatch = line.match(SEM_NOTA_LINE);
    if (semNotaMatch) {
      pushRow("Sem nota", semNotaMatch[1]);
      continue;
    }

    const dataMatch = line.match(DATA_LINE);
    if (dataMatch) {
      pushRow(dataMatch[1], dataMatch[2]);
      continue;
    }

    // Checked before Nome/Bairro so a hyphenated weekday like
    // "Segunda-feira" isn't split into a fake "Segunda" / "feira" row.
    if (isPureDayPeriodLine(line)) {
      applyDayAndPeriod(
        line,
        today,
        (d) => (currentDate = d),
        (p) => (currentPeriod = p),
      );
      continue;
    }

    // "Nome - manhã" / "Josias noite" = diária declarada (antes do Nome/Bairro,
    // senão viraria uma entrega falsa com bairro "manhã").
    const shift = matchShiftLine(line);
    if (shift) {
      shifts.push({ name: shift.name, periodo: shift.periodo, dia: currentDate });
      continue;
    }

    const nameMatch = line.match(NAME_LINE);
    if (nameMatch) {
      pushRow(nameMatch[1].trim(), nameMatch[2]);
      continue;
    }

    const senderMatch = matchSenderLine(line);
    if (senderMatch) {
      currentPhone = senderMatch.phone;
      continue;
    }

    skipped.push(raw);
  }

  return { rows, shifts, skipped };
}
