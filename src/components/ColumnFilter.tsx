"use client";

// Reusable per-column table filters.
//
// Each table declares one `ColFilterDef` per column (in the same order as its
// `<th>` cells). Free-text columns get a search input; categorical columns get
// a multi-choice list (marque um ou vários) auto-populated with every distinct
// value present in the rows.
// `useColumnFilters` returns the filtered rows plus the state wiring, and
// `<FilterRow>` renders the header row of filter controls.

import { useMemo, useState } from "react";
import { MultiSelect } from "./MultiSelect";

export type ColFilterType = "text" | "select" | "none";

export interface ColFilterDef<T> {
  /** Unique key for this column's filter. */
  key: string;
  /** "text" (default) = contains-search; "select" = multi-choice list; "none" = no filter cell. */
  type?: ColFilterType;
  /** Extracts the string used for matching and for building select options. */
  value?: (row: T) => string;
  align?: "left" | "right" | "center";
}

/** Texto (busca) ou, nas colunas "select", a lista de valores marcados. */
export type ColFilterValue = string | string[];

export interface ColumnFilters<T> {
  filters: Record<string, ColFilterValue>;
  /** Busca de uma coluna de texto. */
  set: (key: string, val: string) => void;
  /** Valores marcados de uma coluna de seleção (vários = qualquer um deles). */
  setMany: (key: string, vals: string[]) => void;
  clear: () => void;
  active: number;
  options: Record<string, string[]>;
  filtered: T[];
}

const isOn = (f: ColFilterValue | undefined) => (Array.isArray(f) ? f.length > 0 : !!f);

/** Um valor de linha passa no filtro da coluna? Seleção = qualquer um dos marcados. */
function passes(type: ColFilterType | undefined, f: ColFilterValue, v: string): boolean {
  if (type === "select") {
    const list = Array.isArray(f) ? f : [f];
    return list.includes(v);
  }
  const q = Array.isArray(f) ? f.join(" ") : f;
  return v.toLowerCase().includes(q.toLowerCase());
}

/** Linhas que passam em todos os filtros de coluna ativos (lógica pura). */
export function applyColumnFilters<T>(
  rows: T[],
  defs: ColFilterDef<T>[],
  filters: Record<string, ColFilterValue>,
): T[] {
  return rows.filter((r) => {
    for (const d of defs) {
      const f = filters[d.key];
      if (!isOn(f) || !d.value) continue;
      if (!passes(d.type, f, d.value(r))) return false;
    }
    return true;
  });
}

export function useColumnFilters<T>(rows: T[], defs: ColFilterDef<T>[]): ColumnFilters<T> {
  const [filters, setFilters] = useState<Record<string, ColFilterValue>>({});

  // Faceted options: each dropdown only offers values present in the rows that
  // match every OTHER active filter (e.g. with Tipo = Receita, the Categoria
  // dropdown lists only categories that occur in receitas).
  const options = useMemo(() => {
    const matchesExcept = (r: T, skipKey: string) => {
      for (const d of defs) {
        if (d.key === skipKey) continue;
        const f = filters[d.key];
        if (!isOn(f) || !d.value) continue;
        if (!passes(d.type, f, d.value(r))) return false;
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
        for (const c of Array.isArray(current) ? current : current ? [current] : []) set.add(c);
        o[d.key] = Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
      }
    }
    return o;
  }, [rows, defs, filters]);

  const filtered = useMemo(() => applyColumnFilters(rows, defs, filters), [rows, defs, filters]);

  const active = Object.values(filters).filter(isOn).length;
  const clear = () => setFilters({});
  const set = (key: string, val: string) => setFilters((p) => ({ ...p, [key]: val }));
  const setMany = (key: string, vals: string[]) => setFilters((p) => ({ ...p, [key]: vals }));

  return { filters, set, setMany, clear, active, options, filtered };
}

const control: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  padding: "0.2rem 0.35rem",
  borderRadius: 5,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
  font: "inherit",
  fontSize: "0.74rem",
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
        <th key={d.key} style={{ padding: "0.2rem 0.3rem", verticalAlign: "top" }}>
          {d.type === "none" || !d.value ? null : d.type === "select" ? (
            <MultiSelect
              options={(cf.options[d.key] ?? []).map((o) => ({ value: o, label: o }))}
              selected={(() => {
                const f = cf.filters[d.key];
                return Array.isArray(f) ? f : f ? [f] : [];
              })()}
              onChange={(vals) => cf.setMany(d.key, vals)}
            />
          ) : (
            <input
              value={(() => {
                const f = cf.filters[d.key];
                return Array.isArray(f) ? f.join(" ") : (f ?? "");
              })()}
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
