"use client";

// Seleção múltipla compacta: um botão ("Todos", o nome escolhido ou "3
// selecionados") que abre uma lista com caixas de marcar. Usada nos filtros
// de coluna das tabelas e no filtro de contas de Lançamentos.
//
// A lista abre num portal em posição fixa (relativa à janela): não é cortada
// nem cria rolagem dentro das tabelas com rolagem horizontal, e um toque nela
// não aciona o <label> que envolve o filtro.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface MultiOption {
  value: string;
  label: string;
}

export function MultiSelect({
  options,
  selected,
  onChange,
  allLabel = "Todos",
  style,
}: {
  options: MultiOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Texto do botão sem nada marcado (= sem filtro). */
  allLabel?: string;
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const PANEL_W = 260;

  function place() {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - PANEL_W - 8));
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    if (below >= 200 || below >= above) {
      setPos({ left, top: r.bottom + 4, maxHeight: Math.min(360, below) });
    } else {
      setPos({ left, bottom: window.innerHeight - r.top + 4, maxHeight: Math.min(360, above) });
    }
  }

  useEffect(() => {
    if (!open) return;
    place();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onScroll = (e: Event) => {
      // Rolar a própria lista não fecha; rolar a página, sim.
      if (panelRef.current && e.target instanceof Node && panelRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const chosen = new Set(selected);
  const label =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? selected[0])
        : `${selected.length} selecionados`;

  const toggle = (v: string) => {
    const next = chosen.has(v) ? selected.filter((x) => x !== v) : [...selected, v];
    onChange(next);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={selected.length > 1 ? selected.map((v) => options.find((o) => o.value === v)?.label ?? v).join(", ") : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.35rem",
          width: "100%",
          minWidth: 0,
          padding: "0.25rem 0.4rem",
          borderRadius: 5,
          border: `1px solid ${selected.length > 0 ? "var(--focus)" : "var(--border)"}`,
          background: "var(--bg)",
          color: "var(--text)",
          font: "inherit",
          fontSize: "0.8rem",
          fontWeight: selected.length > 0 ? 600 : 400,
          textAlign: "left",
          cursor: "pointer",
          ...style,
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <span aria-hidden style={{ opacity: 0.6, fontSize: "0.7em" }}>▾</span>
      </button>
      {open && pos && typeof document !== "undefined" && createPortal(
        <div
          ref={panelRef}
          role="listbox"
          aria-multiselectable
          style={{
            position: "fixed",
            left: pos.left,
            top: pos.top,
            bottom: pos.bottom,
            width: PANEL_W,
            maxHeight: pos.maxHeight,
            overflowY: "auto",
            zIndex: 1000,
            background: "var(--surface)",
            color: "var(--text)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
            padding: "0.35rem",
            fontSize: "0.9rem",
            fontWeight: 400,
            textAlign: "left",
          }}
        >
          <div style={{ display: "flex", gap: "0.4rem", padding: "0.2rem 0.25rem 0.4rem", borderBottom: "1px solid var(--border)", marginBottom: "0.25rem" }}>
            <button
              type="button"
              onClick={() => onChange([])}
              style={{ background: "var(--border)", padding: "0.25rem 0.6rem", fontSize: "0.8rem" }}
            >
              Todos
            </button>
            <button
              type="button"
              onClick={() => onChange(options.map((o) => o.value))}
              style={{ background: "var(--border)", padding: "0.25rem 0.6rem", fontSize: "0.8rem" }}
            >
              Marcar todos
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => setOpen(false)}
              style={{ marginLeft: "auto", padding: "0.25rem 0.6rem", fontSize: "0.8rem" }}
            >
              OK
            </button>
          </div>
          {options.length === 0 && <div className="muted" style={{ padding: "0.5rem" }}>Nada para filtrar.</div>}
          {options.map((o) => (
            <label
              key={o.value}
              role="option"
              aria-selected={chosen.has(o.value)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.55rem",
                padding: "0.45rem 0.5rem",
                borderRadius: 6,
                cursor: "pointer",
                background: chosen.has(o.value) ? "var(--border)" : "transparent",
              }}
            >
              <input
                type="checkbox"
                checked={chosen.has(o.value)}
                onChange={() => toggle(o.value)}
                style={{ width: 18, height: 18, margin: 0, flex: "none" }}
              />
              <span>{o.label}</span>
            </label>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
