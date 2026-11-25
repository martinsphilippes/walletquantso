"use client";

// Tab e Shift+Tab passam de um campo para o outro em qualquer tela, também no
// iPad com teclado físico. O Safari, por padrão, só para nas caixas de texto:
// pula os botões (o campo de data, as contas em botões, Salvar/Fechar), as
// caixas de marcar e às vezes as listas de escolha. Aqui a ordem é a da tela
// (a do documento) e inclui todo controle visível e habilitado. Com uma janela
// sobreposta aberta (aria-modal), o giro fica dentro dela. Fica de fora o que
// está escondido ou inerte (menu lateral fechado no celular), os campos só de
// leitura, os desabilitados e os marcados com tabIndex -1.
//
// Entrando numa caixa de texto pelo Tab, o conteúdo fica selecionado, como no
// Tab do próprio navegador: digitar já substitui.

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

export function TabNavigation() {
  useEffect(() => {
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
      if (target instanceof HTMLInputElement && SELECT_ON_FOCUS.test(target.type)) {
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
