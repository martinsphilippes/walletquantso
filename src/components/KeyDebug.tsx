"use client";

// Teste do teclado: um quadro pequeno no canto da tela que mostra o que o app
// recebe do teclado, cada tecla e para onde o foco vai. Liga e desliga tocando
// na versão, no rodapé do menu lateral. Serve para ver, no próprio aparelho de
// quem usa, o que acontece quando o TAB ou outra tecla não faz o esperado.
//
// Não pega foco nem toque (só o botão Fechar), para não mudar o que está
// sendo testado. Lembra se está ligado no próprio aparelho.

import { useEffect, useState } from "react";
import { isAppleTouch } from "@/lib/ui/device";

const STORE = "wq.keydebug";
/** Evento que liga e desliga o quadro (disparado pela versão no menu). */
export const KEY_DEBUG_TOGGLE = "wq:keydebug";
const MAX_LINES = 12;

function describe(el: EventTarget | Element | null): string {
  if (!(el instanceof HTMLElement) || el === document.body) return "nenhum campo";
  const label =
    el.closest("label")?.querySelector("span")?.textContent?.trim() ||
    el.getAttribute("aria-label") ||
    (el instanceof HTMLInputElement ? el.placeholder : "") ||
    el.textContent?.trim().slice(0, 24) ||
    "";
  const kind =
    el.dataset.picker !== undefined
      ? "caixa"
      : el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
        ? "campo"
        : el instanceof HTMLSelectElement
          ? "lista do sistema"
          : el instanceof HTMLButtonElement
            ? "botão"
            : el.tagName.toLowerCase();
  return label ? `${kind} "${label}"` : kind;
}

function browserName(): string {
  const ua = navigator.userAgent;
  if (/CriOS/.test(ua)) return "Chrome";
  if (/FxiOS/.test(ua)) return "Firefox";
  if (/EdgiOS/.test(ua)) return "Edge";
  if ((navigator as Navigator & { standalone?: boolean }).standalone) return "app da tela de início";
  if (/Safari/.test(ua)) return "Safari";
  return "navegador";
}

const clock = () => new Date().toLocaleTimeString("pt-BR");

export function KeyDebug() {
  const [on, setOn] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [focus, setFocus] = useState("");
  const [info, setInfo] = useState("");

  useEffect(() => {
    try {
      setOn(localStorage.getItem(STORE) === "1");
    } catch {
      /* sem armazenamento: começa desligado */
    }
    const toggle = () =>
      setOn((was) => {
        const next = !was;
        try {
          localStorage.setItem(STORE, next ? "1" : "0");
        } catch {
          /* só não lembra */
        }
        return next;
      });
    window.addEventListener(KEY_DEBUG_TOGGLE, toggle);
    return () => window.removeEventListener(KEY_DEBUG_TOGGLE, toggle);
  }, []);

  useEffect(() => {
    if (!on) return;
    setLines([]);
    setInfo(
      `Versão ${process.env.NEXT_PUBLIC_BUILD_SHA ?? "dev"} · ${browserName()} · ${
        isAppleTouch() ? "iPad/iPhone" : "computador"
      } · toque ${navigator.maxTouchPoints}`,
    );
    const push = (s: string) => setLines((prev) => [`${clock()}  ${s}`, ...prev].slice(0, MAX_LINES));
    const onKey = (e: KeyboardEvent) => {
      const where = describe(e.target);
      const mods = `${e.shiftKey ? "Shift+" : ""}${e.altKey ? "Alt+" : ""}${e.ctrlKey ? "Ctrl+" : ""}${e.metaKey ? "Cmd+" : ""}`;
      const name = e.key === " " ? "Espaço" : e.key;
      // Lido depois que o app tratou a tecla.
      setTimeout(() => push(`tecla ${mods}${name} em ${where}${e.defaultPrevented ? " · o app tratou" : ""}`), 0);
    };
    const onFocusIn = (e: FocusEvent) => push(`foco foi para ${describe(e.target)}`);
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocusIn, true);
    const tick = window.setInterval(() => setFocus(describe(document.activeElement)), 400);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocusIn, true);
      window.clearInterval(tick);
    };
  }, [on]);

  if (!on) return null;
  return (
    <div className="key-debug" role="status">
      <div className="key-debug-head">
        <strong>Teste do teclado</strong>
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => window.dispatchEvent(new Event(KEY_DEBUG_TOGGLE))}
        >
          Fechar
        </button>
      </div>
      <div className="muted">{info}</div>
      <div>Foco agora: {focus || "nenhum campo"}</div>
      {lines.length === 0 ? (
        <div className="muted">Toque num campo e aperte TAB para ver o que acontece.</div>
      ) : (
        lines.map((l, i) => <div key={i}>{l}</div>)
      )}
    </div>
  );
}
