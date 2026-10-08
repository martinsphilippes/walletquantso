"use client";

// Campo de data com calendário próprio: um botão mostrando "qui, 08/10/2026"
// que abre um calendário do mês com os dias da semana (dom … sáb), a data
// escolhida por extenso ("quinta-feira, 8 de outubro de 2026"), setas de mês
// e ano e o atalho "Hoje". Substitui o seletor nativo do iPad (a roda com só
// números) em TODOS os campos de data do app.
//
// Controlado por ISO (YYYY-MM-DD). Com `allowEmpty` o valor pode ser "" (os
// filtros de período): o botão mostra o `placeholder` e o calendário ganha
// "Limpar".
//
// O calendário abre num portal em posição fixa (como o MultiSelect): não é
// cortado pelas tabelas com rolagem e um toque nele não aciona o <label> que
// envolve o campo.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { todayBr } from "@/lib/br/date";
import {
  addMonths,
  isIsoDate,
  longDate,
  monthGrid,
  monthTitle,
  partsOf,
  shortDate,
  weekdayOf,
  WEEKDAYS_LONG,
  WEEKDAYS_SHORT,
} from "@/lib/br/calendar";

const PANEL_W = 312;
const PANEL_H = 420;

/** "quinta-feira" → "Quinta-feira" (só a primeira letra). */
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function DatePicker({
  value,
  onChange,
  allowEmpty = false,
  placeholder = "Qualquer data",
  style,
  ariaLabel = "Data",
}: {
  /** ISO (YYYY-MM-DD); vazio só com `allowEmpty`. */
  value: string;
  onChange: (iso: string) => void;
  allowEmpty?: boolean;
  placeholder?: string;
  style?: React.CSSProperties;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const [view, setView] = useState<{ y: number; m: number }>(() => {
    const { y, m } = partsOf(isIsoDate(value) ? value : todayBr());
    return { y, m };
  });
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const today = todayBr();
  const selected = isIsoDate(value) ? value : "";

  // Sem `allowEmpty`, um valor vazio/inválido vira hoje (comportamento antigo
  // do seletor Dia/Mês/Ano), para o formulário nunca ficar sem data.
  useEffect(() => {
    if (!allowEmpty && !isIsoDate(value)) onChange(today);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, allowEmpty]);

  function place() {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - PANEL_W - 8));
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    if (below >= PANEL_H || below >= above) {
      setPos({ left, top: r.bottom + 4, maxHeight: Math.min(PANEL_H, below) });
    } else {
      setPos({ left, bottom: window.innerHeight - r.top + 4, maxHeight: Math.min(PANEL_H, above) });
    }
  }

  function openPanel() {
    const { y, m } = partsOf(selected || today);
    setView({ y, m });
    setOpen(true);
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

  const pick = (iso: string) => {
    onChange(iso);
    setOpen(false);
  };

  const navBtn: React.CSSProperties = {
    background: "transparent",
    border: "1px solid var(--border)",
    color: "var(--text)",
    borderRadius: 8,
    width: 30,
    height: 32,
    flex: "none",
    padding: 0,
    fontSize: "1rem",
    lineHeight: 1,
    cursor: "pointer",
  };
  const footBtn: React.CSSProperties = {
    background: "var(--border)",
    padding: "0.35rem 0.7rem",
    fontSize: "0.82rem",
  };

  const grid = open ? monthGrid(view.y, view.m) : [];

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openPanel())}
        title={selected ? longDate(selected) : undefined}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.4rem",
          padding: "0.35rem 0.55rem",
          borderRadius: 6,
          border: "1px solid var(--border)",
          background: "var(--bg)",
          color: selected ? "var(--text)" : "var(--muted)",
          font: "inherit",
          fontWeight: 400,
          textAlign: "left",
          whiteSpace: "nowrap",
          cursor: "pointer",
          ...style,
        }}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden style={{ opacity: 0.7, flex: "none" }}>
          <rect x="1.5" y="2.5" width="13" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <line x1="1.5" y1="6" x2="14.5" y2="6" stroke="currentColor" strokeWidth="1.3" />
          <line x1="5" y1="1" x2="5" y2="4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          <line x1="11" y1="1" x2="11" y2="4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        <span>{selected ? shortDate(selected) : placeholder}</span>
      </button>

      {open && pos && typeof document !== "undefined" && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Calendário"
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
            borderRadius: 12,
            boxShadow: "0 10px 28px rgba(0,0,0,0.4)",
            padding: "0.6rem",
            fontSize: "0.9rem",
            fontWeight: 400,
            textAlign: "left",
          }}
        >
          {/* Data escolhida por extenso */}
          <div
            style={{
              padding: "0.3rem 0.35rem 0.55rem",
              borderBottom: "1px solid var(--border)",
              marginBottom: "0.5rem",
              lineHeight: 1.25,
            }}
          >
            {selected ? (
              <>
                <div style={{ fontWeight: 700 }}>{cap(WEEKDAYS_LONG[weekdayOf(selected)])}</div>
                <div className="muted" style={{ fontSize: "0.85rem" }}>
                  {longDate(selected).split(", ")[1]}
                </div>
              </>
            ) : (
              <div className="muted">Nenhuma data escolhida</div>
            )}
          </div>

          {/* Navegação de mês e ano */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.25rem", marginBottom: "0.4rem" }}>
            <button type="button" aria-label="Ano anterior" title="Ano anterior" style={navBtn} onClick={() => setView((v) => addMonths(v.y, v.m, -12))}>
              «
            </button>
            <button type="button" aria-label="Mês anterior" title="Mês anterior" style={navBtn} onClick={() => setView((v) => addMonths(v.y, v.m, -1))}>
              ‹
            </button>
            <div style={{ flex: 1, textAlign: "center", fontWeight: 600, fontSize: "0.86rem", whiteSpace: "nowrap" }}>
              {cap(monthTitle(view.y, view.m))}
            </div>
            <button type="button" aria-label="Próximo mês" title="Próximo mês" style={navBtn} onClick={() => setView((v) => addMonths(v.y, v.m, 1))}>
              ›
            </button>
            <button type="button" aria-label="Próximo ano" title="Próximo ano" style={navBtn} onClick={() => setView((v) => addMonths(v.y, v.m, 12))}>
              »
            </button>
          </div>

          {/* Dias da semana */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 2 }}>
            {WEEKDAYS_SHORT.map((w, i) => (
              <div
                key={w}
                className="muted"
                style={{
                  textAlign: "center",
                  fontSize: "0.72rem",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.02em",
                  padding: "0.2rem 0",
                  color: i === 0 || i === 6 ? "var(--warn)" : undefined,
                }}
              >
                {w}
              </div>
            ))}
          </div>

          {/* Grade do mês */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
            {grid.map(({ iso, inMonth }) => {
              const isSel = iso === selected;
              const isToday = iso === today;
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => pick(iso)}
                  aria-label={longDate(iso)}
                  aria-pressed={isSel}
                  style={{
                    height: 38,
                    padding: 0,
                    borderRadius: 8,
                    border: isToday && !isSel ? "1px solid var(--focus)" : "1px solid transparent",
                    background: isSel ? "var(--accent)" : "transparent",
                    color: isSel ? "var(--accent-ink)" : inMonth ? "var(--text)" : "var(--muted)",
                    opacity: inMonth || isSel ? 1 : 0.55,
                    fontWeight: isSel || isToday ? 700 : 500,
                    fontSize: "0.9rem",
                    cursor: "pointer",
                  }}
                >
                  {Number(iso.slice(8, 10))}
                </button>
              );
            })}
          </div>

          {/* Rodapé */}
          <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.55rem", paddingTop: "0.5rem", borderTop: "1px solid var(--border)" }}>
            <button type="button" style={footBtn} onClick={() => pick(today)}>
              Hoje
            </button>
            {allowEmpty && (
              <button type="button" style={footBtn} onClick={() => pick("")}>
                Limpar
              </button>
            )}
            <button type="button" style={{ ...footBtn, marginLeft: "auto" }} onClick={() => setOpen(false)}>
              Fechar
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
