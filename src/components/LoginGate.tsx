"use client";

// Renders its children only for a signed-in user; otherwise shows a login
// form (email/password + Google). Used to protect data-writing pages.

import { useState } from "react";
import { useAuth } from "@/services/auth-context";
import { signIn, signUp, signInWithGoogle } from "@/services/auth";

export function LoginGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (loading) {
    return (
      <div className="panel">
        <p className="muted">Carregando…</p>
      </div>
    );
  }

  if (user) return <>{children}</>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "signin") await signIn(email, password);
      else await signUp(email, password);
    } catch (err) {
      setError(translateAuthError((err as { code?: string }).code, (err as Error).message));
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setError("");
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(translateAuthError((err as { code?: string }).code, (err as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel" style={{ maxWidth: 420 }}>
      <h2>{mode === "signin" ? "Entrar" : "Criar conta"}</h2>
      <form onSubmit={submit}>
        <p>
          <input
            type="email"
            placeholder="E-mail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={inputStyle}
          />
        </p>
        <p>
          <input
            type="password"
            placeholder="Senha"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            style={inputStyle}
          />
        </p>
        <button type="submit" className="btn-primary" disabled={busy}>
          {mode === "signin" ? "Entrar" : "Criar conta"}
        </button>
      </form>

      <p style={{ margin: "0.75rem 0" }}>
        <button onClick={google} disabled={busy} style={{ background: "#db4437" }}>
          Entrar com Google
        </button>
      </p>

      {error && <p className="badge err">{error}</p>}

      <p className="muted">
        {mode === "signin" ? "Ainda não tem conta? " : "Já tem conta? "}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setMode(mode === "signin" ? "signup" : "signin");
            setError("");
          }}
        >
          {mode === "signin" ? "Criar conta" : "Entrar"}
        </a>
      </p>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.6rem",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
  font: "inherit",
};

function translateAuthError(code: string | undefined, fallback: string): string {
  switch (code) {
    case "auth/invalid-email":
      return "E-mail inválido.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "E-mail ou senha incorretos.";
    case "auth/email-already-in-use":
      return "Este e-mail já está cadastrado.";
    case "auth/weak-password":
      return "A senha deve ter ao menos 6 caracteres.";
    case "auth/popup-closed-by-user":
      return "Login com Google cancelado.";
    case "auth/operation-not-allowed":
      return "Método de login não habilitado no Firebase Console.";
    default:
      return fallback || "Falha na autenticação.";
  }
}
