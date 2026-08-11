"use client";

// Converts a WhatsApp conversation (pasted text, or a photo/screenshot run
// through local OCR) into an .xlsx with columns Manhã/Tarde, Cotação,
// Bairro, Telefone, Dia. Ported from the standalone Dia-Dia tool
// (github.com/martinsphilippes/Dia-Dia) -- see src/lib/pedidos-whatsapp for
// the parsing/export logic.
//
// Everything runs in the browser: OCR via a locally-vendored Tesseract.js
// (public/tesseract/), Excel export via the xlsx package already used
// elsewhere in this app. Nothing is uploaded anywhere.

import { useEffect, useMemo, useRef, useState } from "react";
import { createWorker, type Worker } from "tesseract.js";
import { parseConversation, type ParsedRow } from "@/lib/pedidos-whatsapp/parser";
import { downloadWorkbook, previewToText } from "@/lib/pedidos-whatsapp/export";
import { computeFaturamento, summarizeRows } from "@/lib/pedidos-whatsapp/faturamento";
import { downloadCobranca } from "@/lib/pedidos-whatsapp/cobranca";
import { useAuth } from "@/services/auth-context";
import { listClients, addClientBilling } from "@/services/clients";
import { createBill } from "@/services/bills";
import { todayBr } from "@/lib/br/date";
import type { Client } from "@/types";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const EXAMPLE = `*MANHÃ*

7143- Caminho das Árvores
2294- Pituaçu
0574- Pituba
5281- Candeal
8810- Pituba
8448- Garcia

*NOITE*

1436- Pituba
7862- Pituba
0292- Pituba`;

type Tab = "text" | "image";
type StatusType = "ok" | "error" | undefined;
interface Status {
  msg: string;
  type: StatusType;
}
interface FileEntry {
  file: File;
  state: string;
  ok?: boolean;
}

const COLUMN_HEADERS = ["Manhã/Tarde", "Cotação", "Bairro", "Telefone", "Dia"];

export function PedidosWhatsAppTool() {
  const [tab, setTab] = useState<Tab>("text");
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [copyStatus, setCopyStatus] = useState<Status | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [extractStatus, setExtractStatus] = useState<Status | null>(null);
  const [extracting, setExtracting] = useState(false);
  const fallbackRef = useRef<HTMLTextAreaElement>(null);

  const fallbackText = rows.length ? previewToText(rows) : "";

  // ── Faturamento automático por cliente (regras da tela Clientes) ─────────
  const { user } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("");
  const [diariasStr, setDiariasStr] = useState("");
  const [billMsg, setBillMsg] = useState("");
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!user) return;
    listClients(user.uid)
      .then(setClients)
      .catch(() => setClients([]));
  }, [user]);

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === clientId) ?? null,
    [clients, clientId],
  );

  // O faturamento é calculado SEMPRE sobre o texto atual da caixa (parse ao
  // vivo), nunca sobre uma conversão antiga — senão editar/extrair um texto
  // novo sem apertar "Converter" deixaria o cálculo preso em linhas velhas.
  const liveParsed = useMemo(() => {
    if (!selectedClient || !text.trim())
      return { rows: [], shifts: [], skipped: [] as string[] };
    const r = parseConversation(text);
    return { rows: r.rows, shifts: r.shifts, skipped: r.skipped };
  }, [selectedClient, text]);
  const liveRows = liveParsed.rows;

  const faturamento = useMemo(() => {
    if (!selectedClient || (liveRows.length === 0 && liveParsed.shifts.length === 0)) return null;
    const override = diariasStr.trim() === "" ? undefined : parseInt(diariasStr, 10) || 0;
    return computeFaturamento(selectedClient, liveRows, override, liveParsed.shifts);
  }, [selectedClient, liveRows, liveParsed.shifts, diariasStr]);

  // Trocar de cliente ou mudar o texto zera o ajuste manual de diárias.
  useEffect(() => {
    setDiariasStr("");
    setBillMsg("");
  }, [clientId, text]);

  async function generateBillFromFaturamento() {
    if (!user || !selectedClient || !faturamento || faturamento.total <= 0) return;
    setGenerating(true);
    setBillMsg("");
    try {
      const parts: string[] = [];
      if (faturamento.diarias > 0) parts.push(`${faturamento.diarias} diária(s)`);
      parts.push(`${faturamento.entregas} entrega(s)`);
      const billId = await createBill({
        ownerId: user.uid,
        kind: "receivable",
        description: `${selectedClient.name} — ${parts.join(" + ")}`,
        amount: faturamento.total,
        dueDate: todayBr(),
        competenceDate: todayBr(),
        documentNumber: null,
        contactId: selectedClient.contactId ?? null,
        categoryId: selectedClient.categoryId ?? null,
        costCenterId: selectedClient.costCenterId ?? null,
        accountId: selectedClient.accountId ?? null,
        notes:
          `Pedidos WhatsApp: ${faturamento.entregas} entrega(s) ${brl(faturamento.entregasValor)}` +
          (faturamento.diarias > 0
            ? ` + ${faturamento.diarias} diária(s) ${brl(faturamento.diariasValor)} (turnos: ${faturamento.turnos.join(", ")})`
            : ""),
        payments: [],
        createdAt: Date.now(),
      });
      // Registra no histórico do cliente o retrato do que foi cobrado.
      const s = summarizeRows(liveRows);
      await addClientBilling({
        ownerId: user.uid,
        clientId: selectedClient.id!,
        clientName: selectedClient.name,
        createdAt: Date.now(),
        period: s.period,
        diarias: faturamento.diarias,
        diariasValor: faturamento.diariasValor,
        entregas: faturamento.entregas,
        entregasValor: faturamento.entregasValor,
        revenueBase: null,
        revenueValor: null,
        total: faturamento.total,
        details:
          (faturamento.diarias > 0 ? `Diárias: ${faturamento.turnos.join(", ")}. ` : "") +
          `Entregas: ${s.porBairro.map((x) => `${x.qty}x ${x.bairro}`).join(", ")}.`,
        billId,
      });
      setBillMsg(
        `✅ Título de ${brl(faturamento.total)} criado em Contas a receber e registrado no histórico do cliente.`,
      );
    } catch (err) {
      setBillMsg(`❌ Falha ao gerar título: ${(err as Error).message}`);
    } finally {
      setGenerating(false);
    }
  }

  function convert() {
    if (!text.trim()) {
      setStatus({ msg: "Cole o texto da conversa antes de converter.", type: "error" });
      return;
    }
    const result = parseConversation(text);
    if (!result.rows.length) {
      setStatus({ msg: "Nenhuma linha reconhecida foi encontrada.", type: "error" });
      setRows([]);
      return;
    }
    setRows(result.rows);
    downloadWorkbook(result.rows);
    let msg = `${result.rows.length} linha(s) convertida(s) e planilha baixada.`;
    if (result.skipped.length) {
      msg += ` ${result.skipped.length} linha(s) ignorada(s) por não seguir o formato esperado.`;
    }
    setStatus({ msg, type: "ok" });
    setCopyStatus(null);
  }

  // Learned from the standalone tool: some browsers/webviews report a
  // successful clipboard write that never actually reaches the OS
  // clipboard, so we can't fully trust automatic copy. We always keep a
  // pre-populated, already-laid-out (not display:none-toggled) textarea
  // visible below the table -- see the "hidden" prop below -- so a manual
  // native copy gesture is a guaranteed fallback.
  function copyPreview() {
    if (!rows.length) return;
    const el = fallbackRef.current;
    if (!el) return;
    el.focus();
    el.select();
    try {
      el.setSelectionRange(0, el.value.length);
    } catch {
      // ignore
    }
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    if (ok) {
      setCopyStatus({ msg: "Copiado! Se não colar, use o texto selecionado abaixo.", type: "ok" });
      return;
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(fallbackText).then(
        () => setCopyStatus({ msg: "Copiado! Se não colar, use o texto selecionado abaixo.", type: "ok" }),
        () =>
          setCopyStatus({
            msg: "Não copiou automaticamente — o texto abaixo já está selecionado, copie manualmente.",
            type: "error",
          }),
      );
    } else {
      setCopyStatus({
        msg: "Não copiou automaticamente — o texto abaixo já está selecionado, copie manualmente.",
        type: "error",
      });
    }
  }

  function onFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files ?? []);
    setFiles(list.map((file) => ({ file, state: "Aguardando" })));
    setExtractStatus(null);
  }

  async function extractAll() {
    if (!files.length) {
      setExtractStatus({ msg: "Selecione ao menos uma imagem ou arquivo.", type: "error" });
      return;
    }
    setExtracting(true);
    setExtractStatus({ msg: "Processando...", type: undefined });

    const hasImages = files.some((f) => f.file.type.startsWith("image/"));
    let worker: Worker | null = null;

    try {
      if (hasImages) {
        setExtractStatus({
          msg: "Carregando reconhecimento de texto (primeira vez pode demorar um pouco)...",
          type: undefined,
        });
        worker = await createWorker("por", 1, {
          workerPath: "/tesseract/worker.min.js",
          corePath: "/tesseract",
          langPath: "/tesseract",
          gzip: true,
        });
      }

      const texts: string[] = [];
      const updated = [...files];
      for (let i = 0; i < updated.length; i++) {
        updated[i] = { ...updated[i], state: "Processando..." };
        setFiles([...updated]);
        setExtractStatus({ msg: `Processando ${i + 1} de ${updated.length}...`, type: undefined });
        try {
          if (updated[i].file.type.startsWith("image/")) {
            const result = await worker!.recognize(updated[i].file);
            const t = result.data.text || "";
            texts.push(t);
            const lineCount = t.split(/\r?\n/).filter((l) => l.trim()).length;
            updated[i] = { ...updated[i], state: `OK (${lineCount} linha${lineCount === 1 ? "" : "s"})`, ok: true };
          } else {
            const t = await updated[i].file.text();
            texts.push(t);
            updated[i] = { ...updated[i], state: "OK", ok: true };
          }
        } catch {
          updated[i] = { ...updated[i], state: "Erro ao processar", ok: false };
        }
        setFiles([...updated]);
      }

      if (worker) await worker.terminate();

      const combined = texts.join("\n\n").trim();
      if (!combined) {
        setExtractStatus({ msg: "Não foi possível extrair texto de nenhum arquivo.", type: "error" });
        return;
      }
      setText(combined);
      setTab("text");
      setStatus({ msg: 'Texto extraído. Revise abaixo e clique em "Converter e gerar Excel".', type: "ok" });
      setExtractStatus(null);
    } catch (err) {
      setExtractStatus({
        msg: `Erro ao processar: ${err instanceof Error ? err.message : String(err)}`,
        type: "error",
      });
    } finally {
      setExtracting(false);
    }
  }

  return (
    <>
      <div style={{ display: "flex", gap: "1.25rem", borderBottom: "1px solid var(--border)", marginBottom: "1rem" }}>
        <button
          type="button"
          onClick={() => setTab("text")}
          style={tabStyle(tab === "text")}
        >
          Colar texto
        </button>
        <button
          type="button"
          onClick={() => setTab("image")}
          style={tabStyle(tab === "image")}
        >
          Enviar imagens/arquivos
        </button>
      </div>

      {tab === "text" && (
        <div className="panel">
          <label htmlFor="pedidos-input">Texto da conversa</label>
          <textarea
            id="pedidos-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              "*MANHÃ*\n\n7143- Caminho das Árvores\n2294- Pituaçu\n...\n\n*NOITE*\n\n1436- Pituba"
            }
            style={{
              width: "100%",
              minHeight: 260,
              resize: "vertical",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
              fontSize: "0.9rem",
              lineHeight: 1.4,
              marginTop: "0.5rem",
            }}
          />
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem", alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" className="btn-primary" onClick={convert}>
              Converter e gerar Excel
            </button>
            <button type="button" className="btn-secondary" onClick={() => setText(EXAMPLE)}>
              Carregar exemplo
            </button>
            {clients.length > 0 && (
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                title="Calcula o faturamento automaticamente pelas regras do cliente (tela Clientes)."
              >
                <option value="">Cliente (cálculo automático)…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
            {status && <span className={statusClassName(status.type)}>{status.msg}</span>}
          </div>
        </div>
      )}

      {faturamento && selectedClient && (
        <div className="panel">
          <h3 style={{ marginTop: 0, marginBottom: "0.25rem" }}>
            Faturamento — {selectedClient.name}
          </h3>
          <p className="muted" style={{ marginTop: 0, fontSize: "0.82rem" }}>
            Calculado ao vivo do texto na caixa acima ({faturamento.entregas} linha(s)
            reconhecida(s)) — editar o texto recalcula na hora.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
            {(selectedClient.dailyRate ?? 0) > 0 && (
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                <span>Diárias:</span>
                <input
                  value={diariasStr === "" ? String(faturamento.diarias) : diariasStr}
                  onChange={(e) => setDiariasStr(e.target.value)}
                  inputMode="numeric"
                  style={{
                    width: 64,
                    textAlign: "right",
                    padding: "0.3rem 0.4rem",
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    color: "var(--text)",
                    font: "inherit",
                  }}
                />
                <span>
                  × {brl(selectedClient.dailyRate!)} = <strong>{brl(faturamento.diariasValor)}</strong>
                </span>
                <span className="muted" style={{ fontSize: "0.82rem" }}>
                  (detectadas {faturamento.diariasDetectadas}: {faturamento.turnos.join(", ")})
                </span>
              </div>
            )}
            <div>
              Entregas: <strong>{faturamento.entregas}</strong> ={" "}
              <strong>{brl(faturamento.entregasValor)}</strong>{" "}
              <span className="muted" style={{ fontSize: "0.82rem" }}>
                (pela tabela de bairros)
              </span>
            </div>
            {faturamento.semPreco.length > 0 && (
              <div className="badge warn" style={{ alignSelf: "flex-start" }}>
                ⚠ {faturamento.semPreco.reduce((s, x) => s + x.count, 0)} entrega(s) sem preço na
                tabela:{" "}
                {faturamento.semPreco.map((x) => `${x.bairro} (${x.count})`).join(", ")} — cadastre
                esses bairros no cliente para somarem.
              </div>
            )}
            {liveParsed.skipped.length > 0 && (
              <div
                style={{
                  border: "1px solid var(--warn)",
                  borderRadius: 8,
                  padding: "0.5rem 0.7rem",
                }}
              >
                <div style={{ color: "var(--warn)", fontWeight: 600, fontSize: "0.85rem" }}>
                  ⚠ {liveParsed.skipped.length} linha(s) NÃO reconhecida(s) — não contam como
                  entrega nem diária. Se alguma for entrega de verdade, me mostre para eu aprender:
                </div>
                <div
                  style={{
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                    fontSize: "0.78rem",
                    marginTop: "0.35rem",
                    maxHeight: 140,
                    overflowY: "auto",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {liveParsed.skipped.join("\n")}
                </div>
              </div>
            )}
            <div style={{ fontSize: "1.15rem" }}>
              Total (diárias + entregas): <strong style={{ color: "var(--ok)" }}>{brl(faturamento.total)}</strong>
            </div>
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn-primary"
                disabled={generating || faturamento.total <= 0}
                onClick={generateBillFromFaturamento}
              >
                {generating ? "Gerando…" : "Gerar título a receber"}
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={faturamento.total <= 0}
                title="Baixa a planilha de prestação de contas: entregas, motoboys/diárias, totais, período e tabela de preços."
                onClick={() =>
                  downloadCobranca(selectedClient, liveRows, liveParsed.shifts, faturamento)
                }
              >
                📄 Documento de cobrança (Excel)
              </button>
              {billMsg && (
                <span className={`badge ${billMsg.startsWith("✅") ? "ok" : "warn"}`}>{billMsg}</span>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "image" && (
        <div className="panel">
          <label htmlFor="pedidos-file">Fotos, prints ou arquivo de texto exportado</label>
          <input
            id="pedidos-file"
            type="file"
            accept="image/*,.txt"
            multiple
            onChange={onFilesSelected}
            style={{ display: "block", marginTop: "0.5rem" }}
          />
          {files.length > 0 && (
            <div style={{ marginTop: "0.9rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {files.map((f, i) => (
                <div key={i} style={{ display: "flex", gap: "0.6rem", fontSize: "0.88rem" }}>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {f.file.name}
                  </span>
                  <span className={f.ok === true ? "muted" : f.ok === false ? "badge err" : "muted"}>
                    {f.state}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem", alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" className="btn-primary" onClick={extractAll} disabled={extracting}>
              Extrair texto das imagens
            </button>
            {extractStatus && <span className={statusClassName(extractStatus.type)}>{extractStatus.msg}</span>}
          </div>
          <p className="muted" style={{ marginTop: "0.9rem", fontSize: "0.85rem" }}>
            As imagens são processadas no seu navegador (reconhecimento de texto local) — nada é
            enviado para nenhum servidor. Depois de extrair, você pode conferir e corrigir o texto na
            aba &quot;Colar texto&quot; antes de gerar a planilha.
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <div className="panel">
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
            <h3 style={{ margin: 0 }}>Pré-visualização ({rows.length} linha{rows.length === 1 ? "" : "s"})</h3>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
            <button type="button" className="btn-secondary" onClick={copyPreview}>
              Copiar texto
            </button>
            {copyStatus && <span className={statusClassName(copyStatus.type)}>{copyStatus.msg}</span>}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {COLUMN_HEADERS.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.periodo}</td>
                    <td>{r.cotacao}</td>
                    <td>{r.bairro}</td>
                    <td>{r.telefone}</td>
                    <td>{r.dia}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: "0.9rem" }}>
            <label htmlFor="pedidos-copy-fallback" style={{ fontSize: "0.85rem" }}>
              Se o botão &quot;Copiar texto&quot; não colar direito na planilha: toque e segure aqui
              dentro, escolha &quot;Selecionar tudo&quot; e depois &quot;Copiar&quot; no menu do seu
              aparelho — isso sempre funciona, mesmo quando o botão automático falha.
            </label>
            <textarea
              id="pedidos-copy-fallback"
              ref={fallbackRef}
              readOnly
              value={fallbackText}
              style={{ minHeight: 120, marginTop: "0.4rem" }}
            />
          </div>
        </div>
      )}
    </>
  );
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    background: "transparent",
    border: "none",
    borderRadius: 0,
    borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
    color: active ? "var(--text)" : "var(--muted)",
    padding: "0.6rem 0.2rem",
    fontWeight: 600,
  };
}

function statusClassName(type: StatusType): string {
  if (type === "ok") return "badge ok";
  if (type === "error") return "badge err";
  return "muted";
}
