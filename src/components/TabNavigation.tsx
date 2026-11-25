"use client";

// Tab e Shift+Tab passam de um campo para o outro em qualquer tela, no
// computador. A ordem é a da tela (a do documento) e inclui todo controle
// visível e habilitado. Com uma janela sobreposta aberta (aria-modal), o giro
// fica dentro dela. Fica de fora o que está escondido ou inerte (menu lateral
// fechado no celular), os campos só de leitura, os desabilitados e os marcados
// com tabIndex -1.
//
// No iPhone e no iPad o app não mexe no TAB: lá o TAB do teclado físico é do
// próprio Safari, que anda entre os campos de digitar e não entrega a tecla à
// página quando o foco está num botão. Levar o foco a um botão deixaria o TAB
// preso nele. As caixas de escolha e de data do app têm por dentro um campo
// de digitar (sem teclado na tela), então o Safari para nelas também.
//
// Entrando numa caixa de texto pelo Tab, o conteúdo fica selecionado, como no
// Tab do próprio navegador: digitar já substitui. As caixas de escolha e de
// data (data-picker) ficam de fora disso: não se digita nelas.

import { useEffect } from "react";
import { tabTarget } from "@/lib/ui/tab-order";

const FOCUSABLE = 'input:not([type="hidden"]), select, textarea, button, a[href], [tabindex]';
const SELECT_ON_FOCUS = /^(text|search|tel|url|email|password|number)$/;

function isTabbable(el: HTMLElement): boolean {
  if (el.tabIndex < 0) return false;
  if ((el as HTMLButtonElement).disabled) return false;
  if (el instanceof HTMLInputElement && el.readOnly) return false;
  if (el.closest("[inert]")) return false;
  if (el.getClientRects().length === 0) return false;
  if (getComputedStyle(el).visibility === "hidden") return false;
  return true;
}

/** iPhone ou iPad (o iPad se apresenta como Mac, mas tem tela de toque). */
function isAppleTouch(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function TabNavigation() {
  useEffect(() => {
    if (isAppleTouch()) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented || e.isComposing) return;
      const modals = document.querySelectorAll<HTMLElement>('[aria-modal="true"]');
      const scope: ParentNode = modals.length > 0 ? modals[modals.length - 1] : document;
      const list = Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isTabbable);
      if (list.length === 0) return;

      const active = document.activeElement;
      const current = active instanceof HTMLElement && active !== document.body ? active : null;
      const at = current ? list.indexOf(current) : -1;
      const insertAt =
        current && at < 0
          ? list.filter((el) => current.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING).length
          : 0;
      const target = list[tabTarget(list.length, at, insertAt, e.shiftKey)];
      if (!target || target === current) return;

      e.preventDefault();
      target.focus();
      if (
        target instanceof HTMLInputElement &&
        SELECT_ON_FOCUS.test(target.type) &&
        target.dataset.picker === undefined
      ) {
        try {
          target.select();
        } catch {
          /* alguns tipos não aceitam seleção: só o foco basta */
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return null;
}
