"use client";

// Caixa de escolha do app, no lugar do <select> do navegador em todas as telas.
//
// No iPad, o <select> abre a lista do sistema assim que recebe o foco, e o
// teclado físico fica preso nela: o Tab não passa para o campo seguinte. Esta
// caixa é um botão: recebe o foco sem abrir nada, então Tab e Shift+Tab passam
// por ela como por qualquer outro campo.
//
// Toque ou clique abre a lista do app. No teclado: Espaço, Enter ou as setas
// abrem a lista; as setas andam; Enter (ou Espaço) escolhe; Esc fecha sem
// mudar; Tab escolhe o item marcado e segue para o próximo campo. Letras
// digitadas acham o item que começa com elas (com a lista fechada já escolhem,
// como no <select>).
//
// Uso igual ao do <select>: value, onChange((e) => e.target.value), disabled,
// title, style, className e <option> como filhos. `required` só marca a caixa
// para leitores de tela: quem confere o preenchimento é a própria tela, com a
// mensagem dela (como já fazem os cadastros). A lista abre num
// portal em posição fixa (como o calendário): não é cortada pelas tabelas com
// rolagem, fica acima das janelas sobrepostas e um toque nela não aciona o
// <label> que envolve a caixa.

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  edgeIndex,
  optionsFromChildren,
  shownIndex,
  stepIndex,
  typeAheadIndex,
  widestLabels,
} from "@/lib/ui/select-options";

/** Tempo entre letras para elas contarem como uma palavra só ("ban…"). */
const TYPE_AHEAD_MS = 800;
const LIST_MAX_H = 340;
const LIST_MIN_W = 200;

interface SelectBoxProps {
  value?: string | number;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  children?: React.ReactNode;
  disabled?: boolean;
  required?: boolean;
  title?: string;
  style?: React.CSSProperties;
  className?: string;
  id?: string;
  "aria-label"?: string;
}

export function SelectBox({
  value,
  onChange,
  children,
  disabled = false,
  required = false,
  title,
  style,
  className,
  id,
  "aria-label": ariaLabel,
}: SelectBoxProps) {
  const options = optionsFromChildren(children);
  const current = value == null ? "" : String(value);
  const selectedAt = options.findIndex((o) => o.value === current);
  const shownAt = shownIndex(options, current);
  const shown = shownAt >= 0 ? options[shownAt] : null;

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const listId = useId();

  /** Avisa a tela como o <select> faria (só quando o valor muda). */
  const choose = (idx: number) => {
    const o = options[idx];
    if (!o || o.disabled || o.value === current) return;
    const target = { value: o.value };
    onChange?.({ target, currentTarget: target } as unknown as React.ChangeEvent<HTMLSelectElement>);
  };

  const openList = () => {
    if (disabled || options.length === 0) return;
    // Posição calculada já na abertura: a lista aparece no mesmo instante.
    place();
    setActive(shownAt);
    setOpen(true);
  };

  const closeList = (refocus: boolean) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus({ preventScroll: true });
  };

  /** Junta as letras digitadas em sequência e devolve o item que combina. */
  const findTyped = (ch: string, from: number) => {
    const now = Date.now();
    const t = typed.current;
    t.text = now - t.at > TYPE_AHEAD_MS ? ch : t.text + ch;
    t.at = now;
    return typeAheadIndex(options, t.text, from);
  };
  const typing = () => Date.now() - typed.current.at <= TYPE_AHEAD_MS && typed.current.text !== "";

  function place() {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(Math.max(r.width, LIST_MIN_W), vw - 16);
    const left = Math.max(8, Math.min(r.left, vw - width - 8));
    const below = vh - r.bottom - 10;
    const above = r.top - 10;
    const wanted = Math.min(LIST_MAX_H, options.length * 36 + 12);
    if (below >= wanted || below >= above) {
      setPos({ left, width, top: r.bottom + 4, maxHeight: Math.max(120, Math.min(LIST_MAX_H, below)) });
    } else {
      setPos({ left, width, bottom: vh - r.top + 4, maxHeight: Math.min(LIST_MAX_H, above) });
    }
  }

  useEffect(() => {
    if (!open) return;
    place();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (listRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onScroll = (e: Event) => {
      // Rolar a própria lista não fecha; rolar a página, sim.
      if (listRef.current && e.target instanceof Node && listRef.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // O item marcado fica sempre à vista dentro da lista (só a lista rola).
  useEffect(() => {
    const list = listRef.current;
    if (!open || !list || active < 0) return;
    const el = list.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    if (!el) return;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top - 4;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 4;
  }, [open, active, pos]);

  // Desabilitada com a lista aberta (a tela mudou): fecha.
  useEffect(() => {
    if (disabled && open) setOpen(false);
  }, [disabled, open]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const k = e.key;
    if (e.altKey && (k === "ArrowDown" || k === "ArrowUp")) {
      e.preventDefault();
      if (open) {
        choose(active);
        closeList(true);
      } else openList();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const printable = k.length === 1 && (k !== " " || typing());

    if (!open) {
      if (k === "ArrowDown" || k === "ArrowUp" || k === "Enter" || k === " ") {
        e.preventDefault();
        if (k === " " && typing()) {
          const at = findTyped(k, shownAt);
          if (at >= 0) choose(at);
          return;
        }
        openList();
        return;
      }
      if (printable) {
        e.preventDefault();
        const at = findTyped(k, shownAt);
        if (at >= 0) choose(at);
      }
      // Tab e o resto seguem o caminho normal (o Tab passa para o próximo campo).
      return;
    }

    switch (k) {
      case "ArrowDown":
      case "ArrowUp":
      case "PageDown":
      case "PageUp": {
        e.preventDefault();
        const delta = k === "ArrowDown" ? 1 : k === "ArrowUp" ? -1 : k === "PageDown" ? 8 : -8;
        setActive((a) => stepIndex(options, a, delta));
        return;
      }
      case "Home":
      case "End":
        e.preventDefault();
        setActive(edgeIndex(options, k === "Home" ? 1 : -1));
        return;
      case "Enter":
        e.preventDefault();
        choose(active);
        closeList(true);
        return;
      case "Escape":
        // Só fecha a lista, não a janela sobreposta em volta. O React escuta
        // no próprio document (como a janela), então é preciso parar também
        // os outros ouvintes de lá; e o Esc vai marcado como já tratado.
        e.preventDefault();
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        closeList(true);
        return;
      case "Tab":
        // Escolhe o item marcado e deixa o Tab seguir para o próximo campo.
        choose(active);
        setOpen(false);
        return;
    }
    if (k === " " && !printable) {
      e.preventDefault();
      choose(active);
      closeList(true);
      return;
    }
    if (printable) {
      e.preventDefault();
      const at = findTyped(k, active);
      if (at >= 0) setActive(at);
    }
  };

  const sizers = widestLabels(options);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
        aria-required={required || undefined}
        title={title}
        disabled={disabled}
        className={className ? `select-box ${className}` : "select-box"}
        style={style}
        onClick={() => {
          if (open) {
            closeList(true);
            return;
          }
          // O Safari não dá foco a botões tocados: dá aqui, para o Tab seguir dela.
          btnRef.current?.focus({ preventScroll: true });
          openList();
        }}
        onKeyDown={onKeyDown}
        // O Espaço já foi tratado ao descer a tecla; ao soltar, não "clica" de novo.
        onKeyUp={(e) => {
          if (e.key === " ") e.preventDefault();
        }}
      >
        <span className="select-box-text">
          <span className="select-box-value">{shown?.label || "​"}</span>
          {sizers.map((s, i) => (
            <span key={i} className="select-box-sizer" aria-hidden>
              {s}
            </span>
          ))}
        </span>
        <span className="select-box-arrow" aria-hidden>
          ▾
        </span>
      </button>
      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            className="select-box-list"
            style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, maxHeight: pos.maxHeight }}
            // Tocar na lista não tira o foco da caixa.
            onMouseDown={(e) => e.preventDefault()}
          >
            {options.map((o, i) => (
              <div
                key={i}
                id={`${listId}-${i}`}
                data-idx={i}
                role="option"
                aria-selected={i === selectedAt}
                aria-disabled={o.disabled || undefined}
                className={`select-box-option${i === active ? " active" : ""}${i === selectedAt ? " selected" : ""}${o.disabled ? " disabled" : ""}`}
                onMouseMove={() => {
                  if (!o.disabled && i !== active) setActive(i);
                }}
                onClick={() => {
                  if (o.disabled) return;
                  choose(i);
                  closeList(true);
                }}
              >
                <span className="select-box-check" aria-hidden>
                  {i === selectedAt ? "✓" : ""}
                </span>
                <span>{o.label || " "}</span>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
