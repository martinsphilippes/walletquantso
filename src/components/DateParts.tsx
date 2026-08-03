"use client";

// Reusable split date input: three selects for Dia / Mês / Ano.
//
// Controlled by an ISO string value (YYYY-MM-DD). The day is clamped to the
// selected month/year, so e.g. changing from 31/Jan to Fev yields 28/29. Used
// by the lançamento and title (contas a pagar/receber) forms.

const MONTHS = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

/** Number of days in a given month (1-based month). */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

const selectStyle: React.CSSProperties = {
  padding: "0.35rem 0.4rem",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
  font: "inherit",
};

export function DateParts({
  value,
  onChange,
}: {
  /** ISO date (YYYY-MM-DD). Falls back to today when empty/invalid. */
  value: string;
  onChange: (iso: string) => void;
}) {
  const today = new Date();
  const valid = /^\d{4}-\d{2}-\d{2}/.test(value);
  const [y, m, d] = valid
    ? value.split("-").map(Number)
    : [today.getFullYear(), today.getMonth() + 1, today.getDate()];

  const thisYear = today.getFullYear();
  const years: number[] = [];
  for (let yr = thisYear + 2; yr >= thisYear - 8; yr--) years.push(yr);

  const maxDay = daysInMonth(y, m);
  const day = Math.min(d, maxDay);

  const emit = (ny: number, nm: number, nd: number) => {
    const dd = Math.min(nd, daysInMonth(ny, nm));
    onChange(`${ny}-${String(nm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`);
  };

  return (
    <div style={{ display: "flex", gap: "0.3rem" }}>
      <select
        aria-label="Dia"
        value={day}
        onChange={(e) => emit(y, m, Number(e.target.value))}
        style={{ ...selectStyle, flex: "0 0 3.6rem" }}
      >
        {Array.from({ length: maxDay }, (_, i) => i + 1).map((dd) => (
          <option key={dd} value={dd}>
            {String(dd).padStart(2, "0")}
          </option>
        ))}
      </select>
      <select
        aria-label="Mês"
        value={m}
        onChange={(e) => emit(y, Number(e.target.value), day)}
        style={selectStyle}
      >
        {MONTHS.map((mm, i) => (
          <option key={mm} value={i + 1}>
            {mm}
          </option>
        ))}
      </select>
      <select
        aria-label="Ano"
        value={y}
        onChange={(e) => emit(Number(e.target.value), m, day)}
        style={{ ...selectStyle, flex: "0 0 4.8rem" }}
      >
        {years.map((yy) => (
          <option key={yy} value={yy}>
            {yy}
          </option>
        ))}
      </select>
    </div>
  );
}
