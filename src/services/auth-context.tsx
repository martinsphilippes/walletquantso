"use client";

// React context exposing the current Firebase Auth user to the app — and o
// "espaço de trabalho" dele: uma conta normal é dona dos próprios dados
// (ownerId = uid); um ACESSO RESTRITO (e-mail cadastrado em members/ pelo
// dono) trabalha nos dados do dono e só enxerga a tela Motoristas/Corridas.
//
// Abrir rápido: descobrir se o e-mail é acesso restrito exige perguntar ao
// servidor, e antes o app inteiro esperava essa resposta a cada abertura —
// com internet lenta ou conexão ainda subindo, a tela ficava girando no
// "Carregando…". Agora a resposta fica guardada no aparelho (por conta): as
// telas abrem na hora com ela, e a confirmação com o servidor corre por trás
// (se mudou, ajusta). Na primeira vez num aparelho, espera no máximo
// FIRST_LOOKUP_TIMEOUT_MS; sem resposta, segue como conta própria (as regras
// do Firestore protegem os dados) e ajusta quando a resposta chegar.

import { createContext, useContext, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { onAuthChanged } from "./auth";
import { fetchMembership } from "./drivers";

interface AuthState {
  user: User | null;
  loading: boolean;
  /** Dono dos dados em uso: o próprio uid, ou o do dono quando é acesso restrito. */
  ownerId: string | null;
  /** Conta de acesso restrito (só a tela Motoristas/Corridas). */
  restricted: boolean;
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  ownerId: null,
  restricted: false,
});

const FIRST_LOOKUP_TIMEOUT_MS = 5000;
const memberKey = (uid: string) => `wq.member.${uid}`;

/** Dono gravado para esta conta: string (acesso restrito), null (conta própria) ou undefined (nunca visto). */
function readCachedOwner(uid: string): string | null | undefined {
  try {
    const raw = localStorage.getItem(memberKey(uid));
    if (raw == null) return undefined;
    return (JSON.parse(raw) as { ownerId?: string | null }).ownerId ?? null;
  } catch {
    return undefined;
  }
}

function writeCachedOwner(uid: string, ownerId: string | null): void {
  try {
    localStorage.setItem(memberKey(uid), JSON.stringify({ ownerId, at: Date.now() }));
  } catch {
    /* sem armazenamento (aba privada): só não guarda */
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
    ownerId: null,
    restricted: false,
  });

  useEffect(() => {
    let alive = true;
    // Cada troca de usuário invalida as respostas atrasadas da anterior.
    let generation = 0;
    const unsub = onAuthChanged((user) => {
      const gen = ++generation;
      if (!user) {
        if (alive) setState({ user: null, loading: false, ownerId: null, restricted: false });
        return;
      }
      const current = () => alive && gen === generation;
      const apply = (memberOwner: string | null) => {
        if (!current()) return;
        const restricted = !!memberOwner && memberOwner !== user.uid;
        const ownerId = restricted ? memberOwner : user.uid;
        setState((prev) =>
          prev.user === user && !prev.loading && prev.ownerId === ownerId && prev.restricted === restricted
            ? prev
            : { user, loading: false, ownerId, restricted },
        );
      };

      const cached = readCachedOwner(user.uid);
      if (cached !== undefined) apply(cached);
      if (!user.email) {
        apply(null);
        return;
      }
      fetchMembership(user.email)
        .then((m) => {
          const owner = m?.ownerId ?? null;
          writeCachedOwner(user.uid, owner);
          apply(owner);
        })
        .catch(() => {
          // Sem resposta do servidor: fica com o que já se sabia (ou conta própria).
          if (cached === undefined) apply(null);
        });
      if (cached === undefined) {
        setTimeout(() => {
          if (current()) {
            setState((prev) =>
              prev.loading ? { user, loading: false, ownerId: user.uid, restricted: false } : prev,
            );
          }
        }, FIRST_LOOKUP_TIMEOUT_MS);
      }
    });
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

/** Access the current auth state. */
export function useAuth(): AuthState {
  return useContext(AuthContext);
}
