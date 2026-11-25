"use client";

// Campo de data com calendário próprio: mostra "qui, 08/10/2026" e abre um
// calendário do mês com os dias da semana (dom … sáb), a data escolhida por
// extenso ("quinta-feira, 8 de outubro de 2026"), setas de mês e ano e o
// atalho "Hoje". Substitui o seletor nativo do iPad (a roda com só números)
// em TODOS os campos de data do app.
//
// Por dentro é um campo de texto que não abre o teclado da tela e não aceita
// digitação, como a caixa de escolha (SelectBox): no iPad o TAB do teclado
// físico só para em campos de digitar, e assim para também na data e segue
// dela. No teclado: Enter, Espaço ou a seta para baixo abrem o calendário; as
// setas andam pelos dias (para os lados um dia, para cima e para baixo uma
// semana); Page Up e Page Down trocam o mês; Home volta para hoje; Enter
// escolhe; Esc fecha sem mudar. Nos filtros, Delete limpa a data.
//
// Controlado por ISO (YYYY-MM-DD). Com `allowEmpty` o valor pode ser "" (os
// filtros de período): o campo mostra o `placeholder` e o calendário ganha
// "Limpar".
//
// O calendário abre num portal em posição fixa: não é cortado pelas tabelas
// com rolagem, acompanha o campo quando a página rola e um toque nele não
// aciona o <label> que envolve o campo.

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
  shiftDays,
  shiftMonth,
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
  /** Dia marcado pelo teclado com o calendário aberto ("" = nenhum ainda). */
  const [cursor, setCursor] = useState("");
  const boxRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /** Toque ou clique começou dentro do calendário (não fecha ao perder o foco). */
  const pointerInPanel = useRef(false);

  const today = todayBr();
  const selected = isIsoDate(value) ? value : "";

  // Sem `allowEmpty`, um valor vazio/inválido vira hoje (comportamento antigo
  // do seletor Dia/Mês/Ano), para o formulário nunca ficar sem data.
  useEffect(() => {
    if (!allowEmpty && !isIsoDate(value)) onChange(today);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, allowEmpty]);

  /** Posiciona o calendário junto do campo; false se o campo saiu da tela. */
  function place(): boolean {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r) return false;
    if (r.bottom < 0 || r.top > window.innerHeight) return false;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - PANEL_W - 8));
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    if (below >= PANEL_H || below >= above) {
      setPos({ left, top: r.bottom + 4, maxHeight: Math.min(PANEL_H, below) });
    } else {
      setPos({ left, bottom: window.innerHeight - r.top + 4, maxHeight: Math.min(PANEL_H, above) });
    }
    return true;
  }

  const focusField = () => inputRef.current?.focus({ preventScroll: true });

  function openPanel() {
    if (!place()) return;
    const start = selected || today;
    const { y, m } = partsOf(start);
    setView({ y, m });
    setCursor("");
    setOpen(true);
  }

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) focusField();
  };

  const pick = (iso: string) => {
    onChange(iso);
    close(true);
  };

  const moveCursor = (next: string) => {
    setCursor(next);
    const { y, m } = partsOf(next);
    setView({ y, m });
  };

  useEffect(() => {
    if (!open) {
      pointerInPanel.current = false;
      return;
    }
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) {
        pointerInPanel.current = true;
        return;
      }
      if (boxRef.current?.contains(t)) return;
      setOpen(false);
    };
    // A página rolou ou a tela mudou: o calendário acompanha o campo (rolar o
    // próprio calendário não mexe em nada).
    const follow = (e: Event) => {
      if (panelRef.current && e.target instanceof Node && panelRef.current.contains(e.target)) return;
      if (!place()) setOpen(false);
    };
    // Com o foco no campo, as teclas são tratadas por ele. Com o foco em outro
    // lugar: TAB fecha; Esc fecha só o calendário, ouvido antes dos outros
    // (captura) e marcado como já usado, para a janela em volta não fechar.
    const onKey = (e: KeyboardEvent) => {
      if (document.activeElement === inputRef.current) return;
      if (e.key === "Tab") {
        if (!panelRef.current?.contains(document.activeElement)) setOpen(false);
        return;
      }
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
      document.removeEventListener("keydown", onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    const k = e.key;
    if (e.altKey && (k === "ArrowDown" || k === "ArrowUp")) {
      e.preventDefault();
      if (open) close(true);
      else openPanel();
      return;
    }
    // Atalhos (copiar etc.) seguem normais.
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (!open) {
      if (k === "ArrowDown" || k === "ArrowUp" || k === "Enter" || k === " ") {
        e.preventDefault();
        openPanel();
      } else if (k === "Backspace" || k === "Delete") {
        e.preventDefault();
        if (allowEmpty && selected) onChange("");
      } else if (k.length === 1) {
        // Nada se digita no campo: ele só mostra a data escolhida.
        e.preventDefault();
      }
      // TAB e o resto seguem o caminho normal (o TAB vai para o próximo campo).
      return;
    }

    const base = cursor || selected || today;
    switch (k) {
      case "ArrowLeft":
      case "ArrowRight":
      case "ArrowUp":
      case "ArrowDown": {
        e.preventDefault();
        const days = k === "ArrowLeft" ? -1 : k === "ArrowRight" ? 1 : k === "ArrowUp" ? -7 : 7;
        moveCursor(shiftDays(base, days));
        return;
      }
      case "PageUp":
      case "PageDown":
        e.preventDefault();
        moveCursor(shiftMonth(base, (k === "PageUp" ? -1 : 1) * (e.shiftKey ? 12 : 1)));
        return;
      case "Home":
        e.preventDefault();
        moveCursor(today);
        return;
      case "Enter":
      case " ":
        e.preventDefault();
        pick(base);
        return;
      case "Backspace":
      case "Delete":
        e.preventDefault();
        if (allowEmpty) pick("");
        return;
      case "Escape":
        // Só fecha o calendário, não a janela sobreposta em volta (o React
        // escuta no próprio document, como a janela).
        e.preventDefault();
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        close(true);
        return;
      case "Tab":
        // Sai do campo: fica com o dia marcado pelo teclado e o TAB segue.
        if (cursor) onChange(cursor);
        setOpen(false);
        return;
    }
    if (k.length === 1) e.preventDefault();
  };

  const onBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    if (!open) return;
    const to = e.relatedTarget as Node | null;
    if (to && panelRef.current?.contains(to)) return;
    if (!to && pointerInPanel.current) return;
    // Saiu pelo TAB do iPad (que não passa pela página) ou o foco foi para
    // outro lugar: fecha, ficando com o dia que o teclado marcou.
    if (cursor) onChange(cursor);
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
      <span
        ref={boxRef}
        className={`select-box${open ? " is-open" : ""}`}
        title={selected ? longDate(selected) : undefined}
        style={{
          gap: "0.4rem",
          padding: "0.35rem 0.55rem",
          borderRadius: 6,
          whiteSpace: "nowrap",
          ...style,
        }}
        // Clique na moldura não tira o foco do campo nem seleciona texto.
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          // Cancela o clique repetido que o <label> em volta faria no campo.
          e.preventDefault();
          if (open) {
            close(true);
            return;
          }
          focusField();
          openPanel();
        }}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden style={{ opacity: 0.7, flex: "none" }}>
          <rect x="1.5" y="2.5" width="13" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <line x1="1.5" y1="6" x2="14.5" y2="6" stroke="currentColor" strokeWidth="1.3" />
          <line x1="5" y1="1" x2="5" y2="4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          <line x1="11" y1="1" x2="11" y2="4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        <span className="select-box-text">
          <span className="select-box-sizer" aria-hidden>
            {shortDate(selected || today)}
          </span>
          {allowEmpty && (
            <span className="select-box-sizer" aria-hidden>
              {placeholder}
            </span>
          )}
          <input
            ref={inputRef}
            type="text"
            inputMode="none"
            className="select-box-input"
            data-picker=""
            role="combobox"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-label={ariaLabel}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            value={selected ? shortDate(selected) : ""}
            placeholder={placeholder}
            onChange={() => {
              /* o valor é controlado: o campo volta a mostrar a data */
            }}
            onKeyDown={onKeyDown}
            onBlur={onBlur}
            onPaste={(e) => e.preventDefault()}
            onCut={(e) => e.preventDefault()}
            onDrop={(e) => e.preventDefault()}
          />
        </span>
      </span>

      {open && pos && typeof document !== "undefined" && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Calendário"
          // Tocar no calendário não tira o foco do campo (o TAB segue dele).
          onMouseDown={(e) => e.preventDefault()}
          style={{
            position: "fixed",
            left: pos.left,
            top: pos.top,
            bottom: pos.bottom,
            width: PANEL_W,
            maxHeight: pos.maxHeight,
            overflowY: "auto",
            overscrollBehavior: "contain",
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
            <button type="button" tabIndex={-1} aria-label="Ano anterior" title="Ano anterior" style={navBtn} onClick={() => setView((v) => addMonths(v.y, v.m, -12))}>
              «
            </button>
            <button type="button" tabIndex={-1} aria-label="Mês anterior" title="Mês anterior" style={navBtn} onClick={() => setView((v) => addMonths(v.y, v.m, -1))}>
              ‹
            </button>
            <div style={{ flex: 1, textAlign: "center", fontWeight: 600, fontSize: "0.86rem", whiteSpace: "nowrap" }}>
              {cap(monthTitle(view.y, view.m))}
            </div>
            <button type="button" tabIndex={-1} aria-label="Próximo mês" title="Próximo mês" style={navBtn} onClick={() => setView((v) => addMonths(v.y, v.m, 1))}>
              ›
            </button>
            <button type="button" tabIndex={-1} aria-label="Próximo ano" title="Próximo ano" style={navBtn} onClick={() => setView((v) => addMonths(v.y, v.m, 12))}>
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
              // Dia marcado pelo teclado: contorno azul.
              const isCursor = iso === cursor;
              return (
                <button
                  key={iso}
                  type="button"
                  tabIndex={-1}
                  onClick={() => pick(iso)}
                  aria-label={longDate(iso)}
                  aria-pressed={isSel}
                  style={{
                    height: 38,
                    padding: 0,
                    borderRadius: 8,
                    border: isToday && !isSel ? "1px solid var(--focus)" : "1px solid transparent",
                    outline: isCursor ? "2px solid var(--focus)" : undefined,
                    outlineOffset: isCursor ? -2 : undefined,
                    background: isSel ? "var(--accent)" : "transparent",
                    color: isSel ? "var(--accent-ink)" : inMonth ? "var(--text)" : "var(--muted)",
                    opacity: inMonth || isSel ? 1 : 0.55,
                    fontWeight: isSel || isToday || isCursor ? 700 : 500,
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
            <button type="button" tabIndex={-1} style={footBtn} onClick={() => pick(today)}>
              Hoje
            </button>
            {allowEmpty && (
              <button type="button" tabIndex={-1} style={footBtn} onClick={() => pick("")}>
                Limpar
              </button>
            )}
            <button type="button" tabIndex={-1} style={{ ...footBtn, marginLeft: "auto" }} onClick={() => close(true)}>
              Fechar
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
