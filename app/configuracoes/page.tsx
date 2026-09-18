"use client";

// WalletQuantso — Configurações: notificações pelo Telegram.
//
// O dono vincula o próprio Telegram ao robô (link t.me com código de uma
// vez) e passa a receber, todo dia de manhã, as contas a pagar em aberto
// agrupadas por conta financeira. Tudo passa pelo servidor (/api/telegram),
// que guarda a vinculação com o Admin SDK.

import { useCallback, useEffect, useState } from "react";
import { LoginGate } from "@/components/LoginGate";
import { useAuth } from "@/services/auth-context";

interface TelegramState {
  configured: string | null;
  botUsername: string | null;
  linked: boolean;
  chatName: string | null;
  enabled: boolean;
  linkCode: string | null;
  linkUrl: string | null;
  lastSentAt: number | null;
  lastError: string | null;
}

export default function Page() {
  return (
    <>
      <h1>Configurações</h1>
      <LoginGate>
        <TelegramPanel />
      </LoginGate>
    </>
  );
}

function TelegramPanel() {
  const { user, restricted } = useAuth();
  const [st, setSt] = useState<TelegramState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const call = useCallback(
    async (action?: string) => {
      if (!user) return;
      const idToken = await user.getIdToken();
      const res = await fetch("/api/telegram/settings", {
        method: action ? "POST" : "GET",
        headers: { authorization: `Bearer ${idToken}`, "content-type": "application/json" },
        body: action ? JSON.stringify({ action }) : undefined,
      });
      const json = (await res.json()) as TelegramState & { error?: string; messages?: number };
      if (!res.ok) throw new Error(json.error || "Falha ao falar com o servidor.");
      setSt(json);
      return json;
    },
    [user],
  );

  useEffect(() => {
    call().catch((err) => setMsg(`❌ ${(err as Error).message}`));
  }, [call]);

  async function run(action: string, okText: (r: TelegramState & { messages?: number }) => string) {
    setBusy(true);
    setMsg("");
    try {
      const r = await call(action);
      if (r) setMsg(okText(r));
    } catch (err) {
      setMsg(`❌ ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  if (restricted) {
    return <p className="muted">Configurações disponíveis só para o dono da conta.</p>;
  }

  const when = (t: number | null) =>
    t ? new Date(t).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—";

  return (
    <div className="panel">
      <h2>Notificações no Telegram</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Todo dia às <strong>7h</strong> o robô manda três mensagens: as <strong>contas a pagar em aberto,
        agrupadas por conta</strong> (atrasadas em vermelho, vencendo hoje em amarelo), os{" "}
        <strong>gastos do mês até hoje, por categoria</strong> (com subcategorias e percentual) e o{" "}
        <strong>resultado do mês por centro de custo</strong> (receitas, despesas e saldo de cada um). No
        Telegram, mande <code>/tudo</code> para receber os três a qualquer hora, ou <code>/contas</code>,{" "}
        <code>/gastos</code> e <code>/centros</code> para um só.
      </p>

      {!st ? (
        <p className="muted">Carregando…</p>
      ) : st.configured ? (
        <p className="badge warn" style={{ display: "inline-block" }}>
          ⚠ {st.configured}
        </p>
      ) : (
        <>
          <p>
            Status:{" "}
            {st.linked ? (
              <span style={{ color: "var(--ok)", fontWeight: 600 }}>
                ✅ vinculado{st.chatName ? ` (${st.chatName})` : ""} · envio diário{" "}
                {st.enabled ? "ligado" : "desligado"}
              </span>
            ) : (
              <span className="muted">ainda não vinculado</span>
            )}
          </p>

          {!st.linked && (
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
              {st.linkUrl ? (
                <>
                  <a
                    className="btn-primary"
                    href={st.linkUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: "inline-block", textDecoration: "none", padding: "0.5rem 0.9rem", borderRadius: 8 }}
                  >
                    Abrir o Telegram e vincular
                  </a>
                  <span className="muted" style={{ fontSize: "0.85rem" }}>
                    No Telegram, toque em <strong>Iniciar</strong>. Depois volte aqui e toque em Atualizar.
                  </span>
                  <button style={{ background: "var(--border)" }} disabled={busy} onClick={() => run("", () => "Atualizado.")}>
                    Atualizar
                  </button>
                </>
              ) : (
                <button className="btn-primary" disabled={busy} onClick={() => run("link", () => "Agora toque em \"Abrir o Telegram e vincular\".")}>
                  Vincular meu Telegram
                </button>
              )}
            </div>
          )}

          {st.linked && (
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
              <button
                className="btn-primary"
                disabled={busy}
                onClick={() => run("send", (r) => `✅ Enviado (${r.messages ?? 1} mensagem(ns)). Confira no Telegram.`)}
              >
                Enviar agora
              </button>
              <button
                style={{ background: "var(--border)" }}
                disabled={busy}
                onClick={() =>
                  run(st.enabled ? "disable" : "enable", (r) => (r.enabled ? "✅ Envio diário ligado." : "Envio diário desligado."))
                }
              >
                {st.enabled ? "Desligar envio diário" : "Ligar envio diário"}
              </button>
              <button
                style={{ background: "var(--err)" }}
                disabled={busy}
                onClick={() => {
                  if (confirm("Desvincular o Telegram? Os envios param até vincular de novo.")) {
                    void run("unlink", () => "Desvinculado.");
                  }
                }}
              >
                Desvincular
              </button>
            </div>
          )}

          <p className="muted" style={{ fontSize: "0.82rem", marginBottom: 0 }}>
            Último envio: {when(st.lastSentAt)}
            {st.lastError ? ` · último erro: ${st.lastError}` : ""}
            {st.botUsername ? ` · robô: @${st.botUsername}` : ""}
          </p>
        </>
      )}

      {msg && (
        <p style={{ marginBottom: 0 }}>
          <span className={`badge ${msg.startsWith("❌") ? "err" : "ok"}`}>{msg}</span>
        </p>
      )}
    </div>
  );
}
