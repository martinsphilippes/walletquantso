"use client";

// Caixa de escolha do app, no lugar do <select> do navegador em todas as telas.
//
// Por que não o <select>: no iPad ele abre a lista do sistema assim que recebe
// o foco, e o teclado físico fica preso nela.
//
// Por que um campo de texto por dentro: no iPad o TAB do teclado físico só
// chega à página quando o foco está num campo de digitar; com um botão em
// foco, a tecla nem chega. Então a caixa tem por dentro um campo de texto que
// não abre o teclado da tela (inputMode "none") e não aceita digitação: o TAB
// do iPad, levado pelo TabNavigation, para nela e segue dela.
//
// Toque ou clique abre a lista do app. No teclado: Espaço, Enter ou as setas
// abrem a lista; as setas andam; Enter (ou Espaço) escolhe; Esc fecha sem
// mudar. Letras acham o item que começa com elas, sem diferença de acento: com
// a lista fechada já escolhem, como no <select>. O TAB sai da caixa; se o item
// marcado na lista aberta foi mudado pelo teclado, fica com ele.
//
// Uso igual ao do <select>: value, onChange((e) => e.target.value), disabled,
// title, style, className e <option> como filhos. `required` só marca a caixa
// para leitores de tela: quem confere o preenchimento é a própria tela, com a
// mensagem dela. A lista abre num portal em posição fixa: não é cortada pelas
// tabelas com rolagem, fica acima das janelas sobrepostas e acompanha a caixa
// quando a página rola.

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

interface ListPos {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
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
  const [pos, setPos] = useState<ListPos | null>(null);
  const boxRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });
  /** O item marcado foi mudado pelo teclado desde que a lista abriu. */
  const movedByKeys = useRef(false);
  /** Toque ou clique começou dentro da lista (não fecha ao perder o foco). */
  const pointerInList = useRef(false);
  /** A tecla já foi usada na busca por letra (o texto que ela digitaria é ignorado). */
  const keyHandled = useRef(false);
  const listId = useId();

  /** Avisa a tela como o <select> faria (só quando o valor muda). */
  const choose = (idx: number) => {
    const o = options[idx];
    if (!o || o.disabled || o.value === current) return;
    const target = { value: o.value };
    onChange?.({ target, currentTarget: target } as unknown as React.ChangeEvent<HTMLSelectElement>);
  };

  /** Posiciona a lista junto da caixa; false se a caixa saiu da tela. */
  function place(): boolean {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r) return false;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (r.bottom < 0 || r.top > vh) return false;
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
    return true;
  }

  const focusField = () => inputRef.current?.focus({ preventScroll: true });

  const openList = () => {
    if (disabled || options.length === 0 || !place()) return;
    movedByKeys.current = false;
    setActive(shownAt);
    setOpen(true);
  };

  const closeList = (refocus: boolean) => {
    setOpen(false);
    if (refocus) focusField();
  };

  /** Letras digitadas: com a lista aberta marcam o item; fechada, já escolhem. */
  const typeAhead = (text: string) => {
    const clean = text.replace(/[^\p{L}\p{N} ]/gu, "");
    if (!clean) return;
    const now = Date.now();
    const t = typed.current;
    t.text = now - t.at > TYPE_AHEAD_MS ? clean : t.text + clean;
    t.at = now;
    const at = typeAheadIndex(options, t.text, open ? active : shownAt);
    if (at < 0) return;
    if (open) {
      movedByKeys.current = true;
      setActive(at);
    } else choose(at);
  };
  const typing = () => typed.current.text !== "" && Date.now() - typed.current.at <= TYPE_AHEAD_MS;

  useEffect(() => {
    if (!open) {
      pointerInList.current = false;
      return;
    }
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (listRef.current?.contains(t)) {
        pointerInList.current = true;
        return;
      }
      if (boxRef.current?.contains(t)) return;
      setOpen(false);
    };
    // A página rolou ou a tela mudou: a lista acompanha a caixa (rolar a
    // própria lista não mexe em nada).
    const follow = (e: Event) => {
      if (listRef.current && e.target instanceof Node && listRef.current.contains(e.target)) return;
      if (!place()) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
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

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled || e.nativeEvent.isComposing) return;
    const k = e.key;
    if (e.altKey && (k === "ArrowDown" || k === "ArrowUp")) {
      e.preventDefault();
      if (!open) openList();
      else {
        choose(active);
        closeList(true);
      }
      return;
    }
    // Atalhos (copiar etc.) seguem normais.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // Nada se digita no campo: ele só mostra o item escolhido.
    if (k === "Backspace" || k === "Delete") {
      e.preventDefault();
      return;
    }
    if (k.length === 1 && (k !== " " || typing())) {
      e.preventDefault();
      keyHandled.current = true;
      typeAhead(k);
      return;
    }

    if (!open) {
      if (k === "ArrowDown" || k === "ArrowUp" || k === "Enter" || k === " ") {
        e.preventDefault();
        openList();
      }
      // TAB e o resto seguem o caminho normal (o TAB vai para o próximo campo).
      return;
    }

    switch (k) {
      case "ArrowDown":
      case "ArrowUp":
      case "PageDown":
      case "PageUp": {
        e.preventDefault();
        const delta = k === "ArrowDown" ? 1 : k === "ArrowUp" ? -1 : k === "PageDown" ? 8 : -8;
        movedByKeys.current = true;
        setActive((a) => stepIndex(options, a, delta));
        return;
      }
      case "Home":
      case "End":
        e.preventDefault();
        movedByKeys.current = true;
        setActive(edgeIndex(options, k === "Home" ? 1 : -1));
        return;
      case "Enter":
      case " ":
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
        // Sai da caixa: fica com o item marcado pelo teclado e o TAB segue.
        if (movedByKeys.current) choose(active);
        setOpen(false);
        return;
    }
  };

  // Texto que escapou das teclas (letra com acento montada em duas teclas,
  // por exemplo): vira busca por letra. O campo volta sozinho a mostrar o
  // item escolhido, porque o valor dele é controlado.
  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (keyHandled.current) return;
    const data = (e.nativeEvent as InputEvent).data;
    if (data) typeAhead(data);
  };

  const onBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    if (!open) return;
    const to = e.relatedTarget as Node | null;
    if (to && listRef.current?.contains(to)) return;
    if (!to && pointerInList.current) return;
    // O foco saiu sem passar pelo TAB tratado aqui (o próprio navegador
    // mudou o foco, por exemplo): fecha, ficando com o item que o teclado
    // marcou.
    if (movedByKeys.current) choose(active);
    setOpen(false);
  };

  const sizers = widestLabels(options);

  return (
    <>
      <span
        ref={boxRef}
        className={`select-box${open ? " is-open" : ""}${disabled ? " is-disabled" : ""}${className ? ` ${className}` : ""}`}
        style={style}
        title={title}
        // Clique na moldura não tira o foco do campo nem seleciona texto.
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          // Cancela o clique repetido que o <label> em volta faria no campo.
          e.preventDefault();
          if (disabled) return;
          if (open) {
            closeList(true);
            return;
          }
          focusField();
          openList();
        }}
      >
        <span className="select-box-text">
          {(sizers.length > 0 ? sizers : [""]).map((s, i) => (
            <span key={i} className="select-box-sizer" aria-hidden>
              {s || "​"}
            </span>
          ))}
          <input
            ref={inputRef}
            id={id}
            type="text"
            inputMode="none"
            className="select-box-input"
            data-picker=""
            role="combobox"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
            aria-autocomplete="none"
            aria-label={ariaLabel}
            aria-required={required || undefined}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            disabled={disabled}
            value={shown?.label ?? ""}
            onChange={onInput}
            onKeyDown={onKeyDown}
            onKeyUp={() => {
              keyHandled.current = false;
            }}
            onBlur={onBlur}
            onPaste={(e) => e.preventDefault()}
            onCut={(e) => e.preventDefault()}
            onDrop={(e) => e.preventDefault()}
          />
        </span>
        <span className="select-box-arrow" aria-hidden>
          ▾
        </span>
      </span>
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
            // Tocar na lista não tira o foco do campo.
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
