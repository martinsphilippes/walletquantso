"use client";

import { useCallback, useEffect, useState } from "react";
import { LoginGate } from "@/components/LoginGate";
import { useAuth } from "@/services/auth-context";
import { listImportBatches } from "@/services/firestore";
import { revertImport } from "@/services/import";
import type { ImportBatch } from "@/types";

export default function HistoryPage() {
  return (
    <>
      <h1>Histórico de importações</h1>
      <LoginGate>
        <History />
      </LoginGate>
    </>
  );
}

function History() {
  const { user } = useAuth();
  const [batches, setBatches] = useState<ImportBatch[] | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setError("");
    try {
      setBatches(await listImportBatches(user.uid));
    } catch (err) {
      setError(`Falha ao carregar: ${(err as Error).message}`);
      setBatches([]);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  async function undo(batch: ImportBatch) {
    if (!user || !batch.id) return;
    if (
      !confirm(
        `Desfazer a importação de "${batch.sourceFileName}"? Isto removerá ${batch.counts.imported} lançamento(s).`,
      )
    )
      return;
    setBusyId(batch.id);
    setError("");
    try {
      await revertImport(user.uid, batch.id);
      await load();
    } catch (err) {
      setError(`Falha ao desfazer: ${(err as Error).message}`);
    } finally {
      setBusyId(null);
    }
  }

  if (batches === null) {
    return (
      <div className="panel">
        <p className="muted">Carregando…</p>
      </div>
    );
  }

  return (
    <div className="panel">
      {error && <p className="badge err">{error}</p>}
      {batches.length === 0 ? (
        <p className="muted">Nenhuma importação ainda.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Arquivo</th>
              <th>Status</th>
              <th>Gravados</th>
              <th>Ignorados</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.id}>
                <td>{new Date(b.createdAt).toLocaleString("pt-BR")}</td>
                <td>{b.sourceFileName}</td>
                <td>
                  <StatusBadge status={b.status} />
                </td>
                <td>{b.counts.imported}</td>
                <td>{b.counts.ignored}</td>
                <td>
                  {b.status === "committed" ? (
                    <button
                      style={{ background: "var(--err)" }}
                      disabled={busyId === b.id}
                      onClick={() => undo(b)}
                    >
                      {busyId === b.id ? "Desfazendo…" : "Desfazer"}
                    </button>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: ImportBatch["status"] }) {
  const map: Record<ImportBatch["status"], { cls: string; label: string }> = {
    preview: { cls: "warn", label: "Prévia" },
    committed: { cls: "ok", label: "Gravado" },
    reverted: { cls: "err", label: "Desfeito" },
  };
  const { cls, label } = map[status];
  return <span className={`badge ${cls}`}>{label}</span>;
}
