"use client";

// Botão pequeno de atualizar (↻) na barra de cima: recarrega o app para
// pegar a versão mais nova publicada, sem fechar e abrir. Ele também
// confere de tempos em tempos (e sempre que o app volta para a frente) se
// há build novo no servidor; quando há, acende com um ponto verde.

import { useEffect, useState } from "react";

const CHECK_EVERY_MS = 5 * 60 * 1000;
const LOCAL_SHA = process.env.NEXT_PUBLIC_BUILD_SHA ?? "dev";

export function UpdateButton() {
  const [hasUpdate, setHasUpdate] = useState(false);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { sha?: string };
        if (!cancelled && data.sha && data.sha !== "dev" && LOCAL_SHA !== "dev") {
          setHasUpdate(data.sha !== LOCAL_SHA);
        }
      } catch {
        /* sem rede: tenta de novo na próxima */
      }
    };
    void check();
    const timer = setInterval(check, CHECK_EVERY_MS);
    const onVisible = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  const reload = () => {
    setReloading(true);
    window.location.reload();
  };

  return (
    <button
      type="button"
      className={`icon-btn update-btn${hasUpdate ? " has-update" : ""}${reloading ? " spinning" : ""}`}
      onClick={reload}
      aria-label={hasUpdate ? "Nova versão disponível — atualizar" : "Atualizar o sistema"}
      title={
        hasUpdate
          ? "Nova versão disponível — toque para atualizar"
          : `Atualizar o sistema (versão ${LOCAL_SHA})`
      }
    >
      <span className="ic" aria-hidden>↻</span>
      {hasUpdate && <span className="dot" aria-hidden />}
    </button>
  );
}
