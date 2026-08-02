"use client";

import { useMemo, useState } from "react";
import { readSpreadsheet } from "@/lib/import/reader";
import {
  buildPreview,
  detectColumns,
  type NormalizedRow,
  type PreviewResult,
  type RawRow,
} from "@/lib/import/engine";
import {
  reconcileTransfers as mergeTransferPairs,
  reconcileInstallments as groupInstallments,
} from "@/lib/import/reconcile";
import type { CanonicalField, ColumnMapping } from "@/types";
import { LoginGate } from "@/components/LoginGate";
import { useAuth } from "@/services/auth-context";
import { commitImport, revertImport, type CommitReport } from "@/services/import";
import Link from "next/link";

const FIELD_LABELS: Record<CanonicalField, string> = {
  date: "Data",
  description: "Descrição",
  amount: "Valor",
  type: "Tipo (receita/despesa)",
  account: "Conta",
  card: "Cartão",
  category: "Categoria",
  subcategory: "Subcategoria",
  costCenter: "Centro de custo",
  contact: "Contato (fornecedor/cliente)",
  notes: "Observações",
  installment: "Parcela",
  tags: "Tags",
  transferAccount: "Conta destino (transferência)",
};

const ALL_FIELDS = Object.keys(FIELD_LABELS) as CanonicalField[];

export default function ImportPage() {
  return (
    <>
      <h1>Importar lançamentos</h1>
      <LoginGate>
        <Importer />
      </LoginGate>
    </>
  );
}

function Importer() {
  const { user } = useAuth();
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<RawRow[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<CommitReport | null>(null);
  const [reverted, setReverted] = useState(false);
  const [mergeTransfers, setMergeTransfers] = useState(true);
  const [groupParcels, setGroupParcels] = useState(true);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError("");
    setReport(null);
    setReverted(false);
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { headers, rows } = await readSpreadsheet(file);
      if (headers.length === 0) {
        setError("Não foi possível ler cabeçalhos no arquivo.");
        return;
      }
      setFileName(file.name);
      setHeaders(headers);
      setRows(rows);
      setMapping(detectColumns(headers));
    } catch (err) {
      setError(`Falha ao ler o arquivo: ${(err as Error).message}`);
    }
  }

  function setColumn(header: string, field: CanonicalField | null) {
    setMapping((prev) => {
      const next: ColumnMapping = { ...prev };
      if (field) {
        for (const h of Object.keys(next)) {
          if (next[h] === field) next[h] = null;
        }
      }
      next[header] = field;
      return next;
    });
  }

  const preview: PreviewResult | null = useMemo(() => {
    if (rows.length === 0) return null;
    return buildPreview(rows, mapping);
  }, [rows, mapping]);

  // Reconciliation runs on the importable rows; each step is independently
  // toggleable. Transfers are merged first, then installments are grouped.
  const reconciled = useMemo(() => {
    if (!preview) return null;
    let rows = preview.importable;
    let transfersFound = 0;
    let installmentGroupsFound = 0;
    if (mergeTransfers) {
      const r = mergeTransferPairs(rows);
      rows = r.rows;
      transfersFound = r.transfersFound;
    }
    if (groupParcels) {
      const r = groupInstallments(rows);
      rows = r.rows;
      installmentGroupsFound = r.installmentGroupsFound;
    }
    return { rows, transfersFound, installmentGroupsFound };
  }, [preview, mergeTransfers, groupParcels]);

  const rowsToImport: NormalizedRow[] = reconciled?.rows ?? preview?.importable ?? [];

  async function confirmImport() {
    if (!user || !preview) return;
    setBusy(true);
    setError("");
    try {
      const r = await commitImport({
        ownerId: user.uid,
        fileName,
        mapping,
        importable: rowsToImport,
      });
      setReport(r);
    } catch (err) {
      setError(`Falha ao gravar: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (!user || !report) return;
    setBusy(true);
    setError("");
    try {
      await revertImport(user.uid, report.batchId);
      setReverted(true);
    } catch (err) {
      setError(`Falha ao desfazer: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="muted">
        Leitura → mapeamento → pré-visualização → gravação auditável. Duplicidades
        são detectadas contra o que já existe na sua conta; toda importação pode
        ser desfeita.
      </p>

      <div className="panel">
        <h2>1. Selecione o arquivo</h2>
        <input type="file" accept=".csv,.xls,.xlsx,.txt" onChange={onFile} />
        {fileName && (
          <p className="muted">
            {fileName} — {rows.length} linha(s), {headers.length} coluna(s).
          </p>
        )}
        {error && <p className="badge err">{error}</p>}
      </div>

      {headers.length > 0 && !report && (
        <div className="panel">
          <h2>2. Mapeamento de colunas</h2>
          <p className="muted">
            Detectamos automaticamente. “Data”, “Valor” e “Conta” são obrigatórios.
          </p>
          <table>
            <thead>
              <tr>
                <th>Coluna do arquivo</th>
                <th>Campo no WalletQuantso</th>
              </tr>
            </thead>
            <tbody>
              {headers.map((h) => (
                <tr key={h}>
                  <td>{h}</td>
                  <td>
                    <select
                      value={mapping[h] ?? ""}
                      onChange={(e) =>
                        setColumn(h, (e.target.value || null) as CanonicalField | null)
                      }
                    >
                      <option value="">— ignorar —</option>
                      {ALL_FIELDS.map((f) => (
                        <option key={f} value={f}>
                          {FIELD_LABELS[f]}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {preview && !report && (
        <div className="panel">
          <h2>3. Pré-visualização</h2>
          <div className="stat-row">
            <Stat n={preview.rows.length} label="Total" />
            <Stat n={preview.importable.length} label="Importáveis" color="var(--ok)" />
            <Stat
              n={preview.duplicatesInFile.length}
              label="Duplicadas no arquivo"
              color="var(--warn)"
            />
            <Stat n={preview.rejected.length} label="Rejeitadas" color="var(--err)" />
          </div>

          {preview.rejected.length > 0 && (
            <>
              <h3>Linhas com erro</h3>
              <table>
                <thead>
                  <tr>
                    <th>Linha</th>
                    <th>Erros</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rejected.slice(0, 50).map((r) => (
                    <tr key={r.rowNumber}>
                      <td>{r.rowNumber}</td>
                      <td>
                        {r.errors.map((e, i) => (
                          <div key={i} className="badge err" style={{ margin: "2px 0" }}>
                            {e}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <h3>Amostra dos importáveis</h3>
          <table>
            <thead>
              <tr>
                <th>Linha</th>
                <th>Data</th>
                <th>Descrição</th>
                <th>Valor</th>
                <th>Tipo</th>
                <th>Conta</th>
              </tr>
            </thead>
            <tbody>
              {preview.importable.slice(0, 20).map((r) => {
                const t = r.transaction!;
                return (
                  <tr key={r.rowNumber}>
                    <td>{r.rowNumber}</td>
                    <td>{t.date}</td>
                    <td>{t.description}</td>
                    <td>
                      {t.amount.toLocaleString("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                      })}
                    </td>
                    <td>{t.type}</td>
                    <td>{t.accountId}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

        </div>
      )}

      {reconciled && preview && !report && (
        <div className="panel">
          <h2>4. Reconciliação</h2>
          <p>
            <label>
              <input
                type="checkbox"
                checked={mergeTransfers}
                onChange={(e) => setMergeTransfers(e.target.checked)}
              />{" "}
              Unir pares de transferência (saída + entrada de mesmo valor em
              contas diferentes, até 3 dias) em um único lançamento
            </label>
          </p>
          <p>
            <label>
              <input
                type="checkbox"
                checked={groupParcels}
                onChange={(e) => setGroupParcels(e.target.checked)}
              />{" "}
              Agrupar parcelamentos (1/12, 2/12, …) da mesma compra em uma série
            </label>
          </p>
          <div className="stat-row">
            <Stat n={reconciled.transfersFound} label="Transferências unidas" color="var(--accent)" />
            <Stat
              n={reconciled.installmentGroupsFound}
              label="Séries de parcelas"
              color="var(--accent)"
            />
            <Stat n={reconciled.rows.length} label="Lançamentos a gravar" color="var(--ok)" />
          </div>

          <p style={{ marginTop: "1rem" }}>
            <button onClick={confirmImport} disabled={busy || reconciled.rows.length === 0}>
              {busy ? "Gravando…" : `Confirmar e gravar ${reconciled.rows.length} lançamento(s)`}
            </button>
          </p>
        </div>
      )}

      {report && (
        <div className="panel">
          <h2>5. Importação concluída</h2>
          {reverted ? (
            <p className="badge warn">
              Importação desfeita — {report.imported} lançamento(s) removido(s).
            </p>
          ) : (
            <>
              <div className="stat-row">
                <Stat n={report.imported} label="Gravados" color="var(--ok)" />
                <Stat
                  n={report.skippedExistingDb}
                  label="Ignorados (já existiam)"
                  color="var(--warn)"
                />
                <Stat
                  n={report.skippedInFile}
                  label="Ignorados (dup. no arquivo)"
                  color="var(--warn)"
                />
              </div>
              {report.createdAccounts.length > 0 && (
                <p className="muted">
                  Contas criadas: {report.createdAccounts.join(", ")}
                </p>
              )}
              {report.createdCategories.length > 0 && (
                <p className="muted">
                  Categorias criadas: {report.createdCategories.join(", ")}
                </p>
              )}
              <p style={{ marginTop: "1rem" }}>
                <button onClick={undo} disabled={busy} style={{ background: "var(--err)" }}>
                  {busy ? "Desfazendo…" : "Desfazer esta importação"}
                </button>
              </p>
            </>
          )}
          {error && <p className="badge err">{error}</p>}
          <p style={{ marginTop: "1rem" }}>
            <Link href="/history">Ver histórico de importações →</Link>
          </p>
        </div>
      )}
    </>
  );
}

function Stat({ n, label, color }: { n: number; label: string; color?: string }) {
  return (
    <div className="stat">
      <div className="n" style={color ? { color } : undefined}>
        {n}
      </div>
      <div className="muted">{label}</div>
    </div>
  );
}
