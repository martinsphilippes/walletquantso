"use client";

// Janela sobreposta simples: fundo escurecido e uma caixa central com título,
// subtítulo e botão de fechar. Esc ou um toque fora da caixa fecha. Fica
// abaixo dos calendários e listas que abrem em portal (z-index 1000), então
// eles continuam abrindo por cima dela. Respeita a área da barra de status do
// iPhone/iPad e rola por inteiro quando o conteúdo é maior que a tela.

import { useEffect } from "react";

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  width = 980,
}: {
  title: string;
  subtitle?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  /** Largura máxima da caixa, em px (no celular ocupa a tela). */
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 900,
        background: "rgba(0, 0, 0, 0.6)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "calc(env(safe-area-inset-top, 0px) + 16px) 12px calc(env(safe-area-inset-bottom, 0px) + 16px)",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          width: `min(${width}px, 100%)`,
          background: "var(--surface)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          boxShadow: "0 18px 48px rgba(0, 0, 0, 0.5)",
          padding: "1rem 1.1rem 1.1rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", marginBottom: "0.6rem" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0 }}>{title}</h2>
            {subtitle && (
              <div className="muted" style={{ fontSize: "0.85rem", marginTop: 3 }}>
                {subtitle}
              </div>
            )}
          </div>
          <button type="button" className="panel-min" onClick={onClose} aria-label="Fechar" title="Fechar">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
