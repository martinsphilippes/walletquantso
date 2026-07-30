"use client";

import { LoginGate } from "@/components/LoginGate";

export function ComingSoon({ title, note }: { title: string; note: string }) {
  return (
    <>
      <h1>{title}</h1>
      <LoginGate>
        <div className="panel">
          <div className="soon">
            <p>Esta área está em desenvolvimento.</p>
            <p className="muted">{note}</p>
            <span className="chip">Em breve</span>
          </div>
        </div>
      </LoginGate>
    </>
  );
}
