"use client";

// Tab e Shift+Tab passam de um campo para o outro em qualquer tela. A ordem é
// a da tela (a do documento). Com uma janela sobreposta aberta (aria-modal), o
// giro fica dentro dela. Fica de fora o que está escondido ou inerte (menu
// lateral fechado no celular), os campos só de leitura, os desabilitados e os
// marcados com tabIndex -1.
//
// No computador, o TAB passa por todo controle: campos, caixas, botões.
//
// No iPhone e no iPad, o TAB do teclado físico só chega à página quando o
// foco está num campo de digitar, e o Safari não passa sozinho para o campo
// seguinte. Com o foco num botão, a tecla nem chega. Então lá o app leva o
// foco só de campo de digitar em campo de digitar: as caixas de escolha e de
// data do app têm um campo desses por dentro (sem teclado na tela), então
// entram na volta; os botões ficam de fora, para o TAB nunca ficar preso.
//
// Entrando numa caixa de texto pelo Tab, o conteúdo fica selecionado, como no
// Tab do próprio navegador: digitar já substitui. As caixas de escolha e de
// data (data-picker) ficam de fora disso: não se digita nelas.

import { useEffect } from "react";
import { tabTarget } from "@/lib/ui/tab-order";
import { isAppleTouch, isTextEntry, TEXT_ENTRY_TYPES } from "@/lib/ui/device";

const FOCUSABLE = 'input:not([type="hidden"]), select, textarea, button, a[href], [tabindex]';

function isTabbable(el: HTMLElement): boolean {
  if (el.tabIndex < 0) return false;
  if ((el as HTMLButtonElement).disabled) return false;
  if (el instanceof HTMLInputElement && el.readOnly) return false;
  if (el.closest("[inert]")) return false;
  if (el.getClientRects().length === 0) return false;
  if (getComputedStyle(el).visibility === "hidden") return false;
  return true;
}

export function TabNavigation() {
  useEffect(() => {
    const onlyTextEntries = isAppleTouch();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented || e.isComposing) return;
      const modals = document.querySelectorAll<HTMLElement>('[aria-modal="true"]');
      const scope: ParentNode = modals.length > 0 ? modals[modals.length - 1] : document;
      const list = Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => isTabbable(el) && (!onlyTextEntries || isTextEntry(el)),
      );
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
        TEXT_ENTRY_TYPES.test(target.type) &&
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
