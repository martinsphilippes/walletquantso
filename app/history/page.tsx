"use client";

import { useCallback, useEffect, useState } from "react";
import { loadErrorMessage } from "@/lib/errors";
import { LoginGate } from "@/components/LoginGate";
import { useAuth } from "@/services/auth-context";
import { listImportBatches } from "@/services/firestore";
import { revertImport } from "@/services/import";
import { useColumnFilters, FilterRow, type ColFilterDef } from "@/components/ColumnFilter";
import type { ImportBatch } from "@/types";

const STATUS_TEXT: Record<ImportBatch["status"], string> = {
  preview: "Prévia",
  committed: "Gravado",
  reverted: "Desfeito",
};

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
      setError(`Falha ao carregar: ${loadErrorMessage(err)}`);
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

  const defs: ColFilterDef<ImportBatch>[] = [
    { key: "date", value: (b) => new Date(b.createdAt).toLocaleString("pt-BR") },
    { key: "file", value: (b) => b.sourceFileName },
    { key: "status", type: "select", value: (b) => STATUS_TEXT[b.status] },
    { key: "imported", value: (b) => String(b.counts.imported), align: "right" },
    { key: "ignored", value: (b) => String(b.counts.ignored), align: "right" },
    { key: "actions", type: "none" },
  ];
  const cf = useColumnFilters(batches ?? [], defs);

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
            <FilterRow defs={defs} cf={cf} />
          </thead>
          <tbody>
            {cf.filtered.map((b) => (
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
