// Peças puras da caixa de escolha do app (SelectBox): ler as <option> escritas
// como filhos, andar pela lista com as setas e achar o item pelas letras
// digitadas, do jeito do <select> do navegador.

import { Fragment, isValidElement, type ReactNode } from "react";

export interface ChoiceOption {
  value: string;
  label: string;
  disabled: boolean;
}

/** Texto visível de um pedaço de JSX ("Banco (", nome, ")" → "Banco (Inter)"). */
export function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

/**
 * As <option> escritas como filhos, na ordem da tela. Aceita listas vindas de
 * .map, fragmentos, <optgroup> e condições (false/null somem). Como no
 * <select>, uma <option> sem value usa o próprio texto como valor.
 */
export function optionsFromChildren(children: ReactNode): ChoiceOption[] {
  const out: ChoiceOption[] = [];
  const walk = (node: ReactNode) => {
    if (node == null || typeof node === "boolean") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!isValidElement(node)) return;
    const props = node.props as { value?: string | number; children?: ReactNode; disabled?: boolean };
    if (node.type === Fragment || node.type === "optgroup") {
      walk(props.children);
      return;
    }
    if (node.type !== "option") return;
    const label = textOf(props.children).replace(/\s+/g, " ").trim();
    out.push({
      value: props.value != null ? String(props.value) : label,
      label,
      disabled: !!props.disabled,
    });
  };
  walk(children);
  return out;
}

/** Item mostrado na caixa: o do valor atual; sem ele, o primeiro disponível (como o <select>). */
export function shownIndex(options: ChoiceOption[], value: string): number {
  const at = options.findIndex((o) => o.value === value);
  if (at >= 0) return at;
  return options.findIndex((o) => !o.disabled);
}

/**
 * Próximo item ao andar `delta` casas (setas, Page Up/Down), sem dar a volta
 * nas pontas e pulando os desabilitados. Sem item marcado, a seta para baixo
 * vai ao primeiro e a para cima, ao último.
 */
export function stepIndex(options: ChoiceOption[], from: number, delta: number): number {
  const n = options.length;
  if (n === 0) return -1;
  const enabled = (i: number) => i >= 0 && i < n && !options[i].disabled;
  if (from < 0 || from >= n) {
    if (delta >= 0) {
      for (let i = 0; i < n; i++) if (enabled(i)) return i;
    } else {
      for (let i = n - 1; i >= 0; i--) if (enabled(i)) return i;
    }
    return -1;
  }
  const dir = delta >= 0 ? 1 : -1;
  const target = Math.max(0, Math.min(n - 1, from + delta));
  for (let i = target; i >= 0 && i < n; i += dir) if (enabled(i)) return i;
  for (let i = target; i >= 0 && i < n; i -= dir) if (enabled(i)) return i;
  return from;
}

/** Primeiro (dir 1) ou último (dir -1) item disponível: Home e End. */
export function edgeIndex(options: ChoiceOption[], dir: 1 | -1): number {
  return stepIndex(options, -1, dir);
}

/** Minúsculas e sem acento: "Água" e "agua" se encontram. */
export function searchKey(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trimStart();
}

/**
 * Item que começa com o que foi digitado. Uma letra só (ou a mesma letra
 * repetida) passa para o PRÓXIMO item com essa inicial, dando a volta, como no
 * <select>; um começo maior ("ban") procura a partir do item atual.
 * Devolve -1 se nenhum combina.
 */
export function typeAheadIndex(options: ChoiceOption[], typed: string, from: number): number {
  const n = options.length;
  const q = searchKey(typed);
  if (n === 0 || q === "") return -1;
  const sameLetter = [...q].every((c) => c === q[0]);
  const needle = sameLetter ? q[0] : q;
  const start = sameLetter ? from + 1 : Math.max(0, from);
  for (let k = 0; k < n; k++) {
    const i = (((start + k) % n) + n) % n;
    if (!options[i].disabled && searchKey(options[i].label).startsWith(needle)) return i;
  }
  return -1;
}

/**
 * Os textos mais compridos, para a caixa ter a largura do maior item (como o
 * <select>) e não mudar de tamanho a cada escolha.
 */
export function widestLabels(options: ChoiceOption[], max = 3): string[] {
  return [...new Set(options.map((o) => o.label))].sort((a, b) => b.length - a.length).slice(0, max);
}
