"use client";

// Small, dependency-free SVG charts for the reports page.

import { donutSegments, cumulativeBalance, type CumulativePoint } from "@/lib/reports/charts";
import type { MonthTotal } from "@/lib/reports/aggregate";

/** Categorical palette (readable on the dark theme). */
export const PALETTE = [
  "#4f8cff",
  "#2ecc71",
  "#f1c40f",
  "#e67e22",
  "#9b59b6",
  "#1abc9c",
  "#ff5d5d",
  "#8395a7",
];

export interface DonutItem {
  label: string;
  value: number;
  color: string;
}

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function DonutChart({ items, size = 200 }: { items: DonutItem[]; size?: number }) {
  const segs = donutSegments(items.map((i) => i.value));
  const total = items.reduce((s, i) => s + i.value, 0);
  const stroke = 26;
  const r = size / 2 - stroke / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2;
  const cy = size / 2;

  if (total <= 0) return <p className="muted">Sem dados para o gráfico.</p>;

  return (
    <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", alignItems: "center" }}>
      <svg width={size} height={size} role="img" aria-label="Gráfico de pizza por categoria">
        {items.map((it, i) => {
          const seg = segs[i];
          if (seg.fraction <= 0) return null;
          return (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={it.color}
              strokeWidth={stroke}
              strokeDasharray={`${seg.fraction * c} ${c}`}
              transform={`rotate(${seg.offset * 360 - 90} ${cx} ${cy})`}
            />
          );
        })}
        <text x={cx} y={cy - 4} textAnchor="middle" fill="var(--muted)" fontSize="12">
          Total
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" fill="var(--text)" fontSize="13" fontWeight="700">
          {brl(total)}
        </text>
      </svg>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: "0.9rem" }}>
        {items.map((it, i) => (
          <li key={i} style={{ display: "flex", alignItems: "center", gap: "0.5rem", margin: "3px 0" }}>
            <span
              style={{ width: 12, height: 12, borderRadius: 3, background: it.color, display: "inline-block" }}
            />
            <span style={{ flex: 1 }}>{it.label}</span>
            <span className="muted">
              {brl(it.value)} ({total ? ((it.value / total) * 100).toFixed(1) : "0"}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CumulativeChart({ months, width = 640, height = 180 }: {
  months: MonthTotal[];
  width?: number;
  height?: number;
}) {
  const points: CumulativePoint[] = cumulativeBalance(months);
  if (points.length === 0) return <p className="muted">Sem dados para o gráfico.</p>;

  const pad = 28;
  const values = points.map((p) => p.cumulative);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const stepX = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0;
  const x = (i: number) => pad + i * stepX;
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);
  const zeroY = y(0);

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.cumulative)}`).join(" ");
  const area = `${line} L ${x(points.length - 1)} ${zeroY} L ${x(0)} ${zeroY} Z`;

  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={width} height={height} role="img" aria-label="Evolução do saldo acumulado">
        <line x1={pad} y1={zeroY} x2={width - pad} y2={zeroY} stroke="var(--border)" />
        <path d={area} fill="rgba(79,140,255,0.15)" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(p.cumulative)} r="3" fill="var(--accent)" />
            <text x={x(i)} y={height - 8} textAnchor="middle" fill="var(--muted)" fontSize="10">
              {p.month.slice(5)}/{p.month.slice(2, 4)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export interface BarItem {
  label: string;
  value: number;
  color: string;
}

/** Simple vertical bar comparison (e.g. Receitas × Despesas). */
export function BarChart({ items, height = 160 }: { items: BarItem[]; height?: number }) {
  const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-around",
          gap: "1rem",
          height,
          padding: "0.5rem 0",
        }}
      >
        {items.map((it, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, height: "100%", justifyContent: "flex-end" }}>
            <span className="muted" style={{ fontSize: "0.8rem", marginBottom: 4 }}>{brl(it.value)}</span>
            <div
              style={{
                width: "60%",
                maxWidth: 90,
                height: `${(Math.abs(it.value) / max) * 100}%`,
                minHeight: 2,
                background: it.color,
                borderRadius: "4px 4px 0 0",
              }}
            />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-around", gap: "1rem" }}>
        {items.map((it, i) => (
          <div key={i} style={{ flex: 1, textAlign: "center" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.85rem" }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: it.color, display: "inline-block" }} />
              {it.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
