"use client";

// Cabeçalho de quadro (painel) com botão de minimizar no canto direito.
//
// Vai no lugar do <h2> do painel: quando minimizado, tudo o que vem depois
// dele dentro do painel some (regra CSS `.panel-head[data-collapsed] ~ *`),
// sobrando só o título e o botão. A escolha fica lembrada no aparelho por
// `id` (localStorage), então os quadros que você fecha continuam fechados.

import { useSyncExternalStore } from "react";

const KEY = "wq.panels.collapsed";

function loadAll(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

// Loja mínima para o useSyncExternalStore: no servidor (e na hidratação) todo
// quadro começa aberto; no aparelho vale o que está guardado, sem erro de
// hidratação e sem piscar.
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

function save(id: string, collapsed: boolean) {
  try {
    const all = loadAll();
    if (collapsed) all[id] = true;
    else delete all[id];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
  listeners.forEach((fn) => fn());
}

export function PanelHead({
  id,
  title,
  children,
}: {
  /** Chave estável do quadro (guardada no aparelho). */
  id: string;
  title: React.ReactNode;
  /** Conteúdo extra ao lado do título (ex.: totais), visível mesmo minimizado. */
  children?: React.ReactNode;
}) {
  const collapsed = useSyncExternalStore(
    subscribe,
    () => !!loadAll()[id],
    () => false,
  );
  const toggle = () => save(id, !collapsed);
  return (
    <div className="panel-head" data-collapsed={collapsed ? "true" : "false"}>
      <h2>{title}</h2>
      {children}
      <button
        type="button"
        className="panel-min"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-label={collapsed ? `Expandir ${typeof title === "string" ? title : "quadro"}` : `Minimizar ${typeof title === "string" ? title : "quadro"}`}
        title={collapsed ? "Expandir" : "Minimizar"}
      >
        {collapsed ? "+" : "−"}
      </button>
    </div>
  );
}
