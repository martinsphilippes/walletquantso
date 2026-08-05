"use client";

// Reusable per-column table filters.
//
// Each table declares one `ColFilterDef` per column (in the same order as its
// `<th>` cells). Free-text columns get a search input; categorical columns get
// a dropdown auto-populated with every distinct value present in the rows.
// `useColumnFilters` returns the filtered rows plus the state wiring, and
// `<FilterRow>` renders the header row of filter controls.

import { useMemo, useState } from "react";

export type ColFilterType = "text" | "select" | "none";

export interface ColFilterDef<T> {
  /** Unique key for this column's filter. */
  key: string;
  /** "text" (default) = contains-search; "select" = dropdown; "none" = no filter cell. */
  type?: ColFilterType;
  /** Extracts the string used for matching and for building select options. */
  value?: (row: T) => string;
  align?: "left" | "right" | "center";
}

export interface ColumnFilters<T> {
  filters: Record<string, string>;
  set: (key: string, val: string) => void;
  clear: () => void;
  active: number;
  options: Record<string, string[]>;
  filtered: T[];
}

export function useColumnFilters<T>(rows: T[], defs: ColFilterDef<T>[]): ColumnFilters<T> {
  const [filters, setFilters] = useState<Record<string, string>>({});

  // Faceted options: each dropdown only offers values present in the rows that
  // match every OTHER active filter (e.g. with Tipo = Receita, the Categoria
  // dropdown lists only categories that occur in receitas).
  const options = useMemo(() => {
    const matchesExcept = (r: T, skipKey: string) => {
      for (const d of defs) {
        if (d.key === skipKey) continue;
        const f = filters[d.key];
        if (!f || !d.value) continue;
        const v = d.value(r);
        if (d.type === "select") {
          if (v !== f) return false;
        } else if (!v.toLowerCase().includes(f.toLowerCase())) {
          return false;
        }
      }
      return true;
    };
    const o: Record<string, string[]> = {};
    for (const d of defs) {
      if (d.type === "select" && d.value) {
        const set = new Set<string>();
        for (const r of rows) {
          if (!matchesExcept(r, d.key)) continue;
          const v = d.value(r);
          if (v) set.add(v);
        }
        // Keep the current selection visible even if no row matches anymore.
        const current = filters[d.key];
        if (current) set.add(current);
        o[d.key] = Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
      }
    }
    return o;
  }, [rows, defs, filters]);

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        for (const d of defs) {
          const f = filters[d.key];
          if (!f || !d.value) continue;
          const v = d.value(r);
          if (d.type === "select") {
            if (v !== f) return false;
          } else if (!v.toLowerCase().includes(f.toLowerCase())) {
            return false;
          }
        }
        return true;
      }),
    [rows, defs, filters],
  );

  const active = Object.values(filters).filter(Boolean).length;
  const clear = () => setFilters({});
  const set = (key: string, val: string) =>
    setFilters((p) => ({ ...p, [key]: val }));

  return { filters, set, clear, active, options, filtered };
}

const control: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  padding: "0.25rem 0.4rem",
  borderRadius: 5,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
  font: "inherit",
  fontSize: "0.8rem",
};

/** Renders a header row of filter controls, one cell per column def. */
export function FilterRow<T>({
  defs,
  cf,
  placeholder = "Filtrar…",
}: {
  defs: ColFilterDef<T>[];
  cf: ColumnFilters<T>;
  placeholder?: string;
}) {
  return (
    <tr>
      {defs.map((d) => (
        <th key={d.key} style={{ padding: "0.25rem 0.4rem", verticalAlign: "top" }}>
          {d.type === "none" || !d.value ? null : d.type === "select" ? (
            <select
              value={cf.filters[d.key] ?? ""}
              onChange={(e) => cf.set(d.key, e.target.value)}
              style={control}
            >
              <option value="">Todos</option>
              {(cf.options[d.key] ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={cf.filters[d.key] ?? ""}
              onChange={(e) => cf.set(d.key, e.target.value)}
              placeholder={placeholder}
              style={{ ...control, textAlign: d.align === "right" ? "right" : "left" }}
            />
          )}
        </th>
      ))}
    </tr>
  );
}
