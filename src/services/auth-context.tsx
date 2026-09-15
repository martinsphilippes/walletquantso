"use client";

// React context exposing the current Firebase Auth user to the app — and o
// "espaço de trabalho" dele: uma conta normal é dona dos próprios dados
// (ownerId = uid); um ACESSO RESTRITO (e-mail cadastrado em members/ pelo
// dono) trabalha nos dados do dono e só enxerga a tela Motoristas/Corridas.

import { createContext, useContext, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { onAuthChanged } from "./auth";
import { getMembership } from "./drivers";

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
    ownerId: null,
    restricted: false,
  });

  useEffect(() => {
    let alive = true;
    const unsub = onAuthChanged(async (user) => {
      if (!user) {
        if (alive) setState({ user: null, loading: false, ownerId: null, restricted: false });
        return;
      }
      // Descobre se o e-mail é um acesso restrito ANTES de liberar as telas,
      // para nenhuma consulta sair com o ownerId errado.
      const membership = user.email ? await getMembership(user.email) : null;
      if (!alive) return;
      if (membership && membership.ownerId !== user.uid) {
        setState({ user, loading: false, ownerId: membership.ownerId, restricted: true });
      } else {
        setState({ user, loading: false, ownerId: user.uid, restricted: false });
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
