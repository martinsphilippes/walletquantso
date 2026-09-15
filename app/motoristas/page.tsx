"use client";

// WalletQuantso — Motoristas / Corridas.
//
// A tela dos motoristas (e das contas de acesso restrito): cadastrar
// motoristas, lançar quantas diárias e corridas cada um fez em cada empresa
// (cliente) e, com isso, gerar o título a pagar do motorista no dia de
// pagamento configurado pelo dono. O dono ainda define os valores pagos por
// diária/corrida, a classificação do título e quais e-mails têm acesso
// restrito a esta tela.

import { useCallback, useEffect, useMemo, useState } from "react";
import { loadErrorMessage } from "@/lib/errors";
import { LoginGate } from "@/components/LoginGate";
import { DateParts } from "@/components/DateParts";
import { useAuth } from "@/services/auth-context";
import { onListsChange } from "@/services/live-store";
import { listAccounts, listCategories, listCostCenters } from "@/services/firestore";
import { listClients } from "@/services/clients";
import { createBill } from "@/services/bills";
import {
  addMember,
  createDriver,
  createRide,
  getDriverSettings,
  listDrivers,
  listMembers,
  listRides,
  normalizeEmail,
  removeDriver,
  removeMember,
  removeRide,
  saveDriverSettings,
  updateRide,
} from "@/services/drivers";
import { computeDriverPayout, describeDue, payDueDate, ruleForClient, WEEKDAY_NAMES } from "@/lib/drivers/pay";
import { parseBrCurrency } from "@/lib/br/parse";
import { todayBr } from "@/lib/br/date";
import type {
  Account,
  Category,
  Client,
  ClientPayRule,
  CostCenter,
  PayRule,
  Driver,
  DriverSettings,
  Member,
  RideEntry,
} from "@/types";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const brDate = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "—");

export default function MotoristasPage() {
  return (
    <>
      <h1>Motoristas / Corridas</h1>
      <LoginGate>
        <Motoristas />
      </LoginGate>
    </>
  );
}

function Motoristas() {
  const { user, ownerId, restricted } = useAuth();
  const me = user?.email ?? user?.uid ?? "";

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [rides, setRides] = useState<RideEntry[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [settings, setSettings] = useState<DriverSettings | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!ownerId) return;
    setError("");
    try {
      const [d, r, c, s] = await Promise.all([
        listDrivers(ownerId),
        listRides(ownerId),
        listClients(ownerId),
        getDriverSettings(ownerId),
      ]);
      setDrivers(d);
      setRides(r);
      setClients(c);
      setSettings(s);
      if (!restricted) {
        const [m, a, cat, cc] = await Promise.all([
          listMembers(ownerId),
          listAccounts(ownerId),
          listCategories(ownerId),
          listCostCenters(ownerId),
        ]);
        setMembers(m);
        setAccounts(a);
        setCategories(cat.filter((x) => x.kind === "expense"));
        cc.sort((x, y) => x.name.localeCompare(y.name, "pt-BR"));
        setCostCenters(cc);
      }
    } catch (err) {
      setError(`Falha ao carregar: ${loadErrorMessage(err)}`);
    } finally {
      setLoaded(true);
    }
  }, [ownerId, restricted]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => onListsChange(() => { void load(); }), [load]);

  const driverName = useMemo(() => new Map(drivers.map((d) => [d.id!, d.name])), [drivers]);
  const clientName = useMemo(() => new Map(clients.map((c) => [c.id!, c.name])), [clients]);
  const activeDrivers = drivers.filter((d) => d.active !== false);

  // ── Lançar corridas ──────────────────────────────────────────────────────
  const [rDriver, setRDriver] = useState("");
  const [rClient, setRClient] = useState("");
  const [rDate, setRDate] = useState(todayBr());
  const [rDiarias, setRDiarias] = useState("1");
  const [rCorridas, setRCorridas] = useState("");
  const [rNotes, setRNotes] = useState("");
  const [rideMsg, setRideMsg] = useState("");

  async function lancar() {
    if (!ownerId) return;
    const diarias = Math.max(0, Math.floor(Number(rDiarias) || 0));
    const corridas = Math.max(0, Math.floor(Number(rCorridas) || 0));
    if (!rDriver) return setRideMsg("Escolha o motorista.");
    if (!rClient) return setRideMsg("Escolha a empresa.");
    if (diarias === 0 && corridas === 0) return setRideMsg("Informe as diárias e/ou as corridas.");
    setBusy(true);
    setRideMsg("");
    try {
      await createRide({
        ownerId,
        driverId: rDriver,
        clientId: rClient,
        date: rDate,
        diarias,
        corridas,
        notes: rNotes.trim() || null,
        createdAt: Date.now(),
        createdBy: me,
        billId: null,
      });
      setRideMsg(
        `✅ ${driverName.get(rDriver)}: ${diarias} diária(s) e ${corridas} corrida(s) em ${clientName.get(rClient)} (${brDate(rDate)}).`,
      );
      setRCorridas("");
      setRNotes("");
      await load();
    } catch (err) {
      setRideMsg(`❌ Falha ao lançar: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function excluirRide(r: RideEntry) {
    if (!r.id) return;
    if (r.billId) {
      setRideMsg("Este lançamento já entrou num título gerado — não pode ser excluído.");
      return;
    }
    if (!confirm(`Excluir o lançamento de ${brDate(r.date)} (${driverName.get(r.driverId) ?? "?"})?`)) return;
    setBusy(true);
    try {
      await removeRide(r.id);
      await load();
    } catch (err) {
      setRideMsg(`❌ Falha ao excluir: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  // ── Motoristas ───────────────────────────────────────────────────────────
  const [newDriver, setNewDriver] = useState("");
  const [driverMsg, setDriverMsg] = useState("");

  async function cadastrarMotorista() {
    if (!ownerId) return;
    const name = newDriver.trim();
    if (!name) return setDriverMsg("Informe o nome do motorista.");
    if (drivers.some((d) => d.name.toLowerCase() === name.toLowerCase())) {
      return setDriverMsg("Já existe um motorista com esse nome.");
    }
    setBusy(true);
    setDriverMsg("");
    try {
      await createDriver({ ownerId, name, active: true, createdAt: Date.now(), createdBy: me });
      setNewDriver("");
      setDriverMsg(`✅ ${name} cadastrado.`);
      await load();
    } catch (err) {
      setDriverMsg(`❌ Falha ao cadastrar: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function excluirMotorista(d: Driver) {
    if (!d.id) return;
    if (rides.some((r) => r.driverId === d.id)) {
      setDriverMsg(`${d.name} tem corridas lançadas — não pode ser excluído.`);
      return;
    }
    if (!confirm(`Excluir o motorista ${d.name}?`)) return;
    setBusy(true);
    try {
      await removeDriver(d.id);
      await load();
    } catch (err) {
      setDriverMsg(`❌ Falha ao excluir: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  // ── Gerar título a pagar (por motorista × empresa) ───────────────────────
  const [payTarget, setPayTarget] = useState<{ driverId: string; clientId: string } | null>(null);
  const [payDue, setPayDue] = useState("");
  const [payMsg, setPayMsg] = useState("");

  const payRule = payTarget ? ruleForClient(settings, payTarget.clientId) : null;
  const payout =
    payTarget && payRule
      ? computeDriverPayout(rides, payTarget.driverId, payTarget.clientId, payRule)
      : null;

  function abrirPagamento(driverId: string, clientId: string) {
    const rule = ruleForClient(settings, clientId);
    if (!rule) {
      setPayMsg(`A empresa ${clientName.get(clientId) ?? "?"} ainda não tem regra de pagamento configurada.`);
      return;
    }
    setPayTarget({ driverId, clientId });
    setPayDue(payDueDate(todayBr(), rule));
    setPayMsg("");
  }

  async function gerarTitulo() {
    if (!ownerId || !payTarget || !payout || !payRule || !settings) return;
    if (payout.total <= 0) return setPayMsg("Não há corridas em aberto para este motorista nesta empresa.");
    const d = drivers.find((x) => x.id === payTarget.driverId);
    const empresa = clientName.get(payTarget.clientId) ?? "?";
    if (!d) return;
    setBusy(true);
    setPayMsg("");
    try {
      const parts: string[] = [];
      if (payout.diarias > 0) parts.push(`${payout.diarias} diária(s)`);
      if (payout.corridas > 0) parts.push(`${payout.corridas} corrida(s)`);
      const billId = await createBill({
        ownerId,
        kind: "payable",
        description: `Motorista ${d.name} — ${empresa} — ${parts.join(" + ")}${payout.period ? ` (${payout.period})` : ""}`,
        amount: payout.total,
        dueDate: payDue,
        competenceDate: payDue,
        documentNumber: null,
        contactId: null,
        categoryId: settings.categoryId ?? null,
        costCenterId: settings.costCenterId ?? null,
        accountId: settings.accountId ?? null,
        notes:
          `${empresa}: ${payout.diarias} diária(s) × ${brl(payRule.diariaValue)} = ${brl(payout.diariasValor)}; ` +
          `${payout.corridas} corrida(s) × ${brl(payRule.corridaValue)} = ${brl(payout.corridasValor)}. ` +
          `Gerado na tela Motoristas por ${me}.`,
        payments: [],
        createdAt: Date.now(),
      });
      for (const id of payout.rideIds) await updateRide(id, { billId });
      setPayMsg(`✅ Título de ${brl(payout.total)} criado em Contas a pagar (venc. ${brDate(payDue)}).`);
      setPayTarget(null);
      await load();
    } catch (err) {
      setPayMsg(`❌ Falha ao gerar título: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  // ── Configuração (só o dono): classificação geral + regra por empresa ────
  const [cfg, setCfg] = useState({ accountId: "", categoryId: "", costCenterId: "" });
  const [cfgMsg, setCfgMsg] = useState("");
  useEffect(() => {
    if (!settings) return;
    setCfg({
      accountId: settings.accountId ?? "",
      categoryId: settings.categoryId ?? "",
      costCenterId: settings.costCenterId ?? "",
    });
  }, [settings]);

  const emptyRule = {
    id: "",
    payMode: "weekday" as "monthDay" | "weekday",
    payWeekday: "2",
    payDay: "5",
    diariaValue: "",
    corridaValue: "",
    clientIds: [] as string[],
  };
  const [rule, setRule] = useState(emptyRule);
  const [ruleClientPick, setRuleClientPick] = useState("");
  const savedRules: PayRule[] = settings?.rules ?? [];

  function editarRegra(r: PayRule) {
    setRule({
      id: r.id,
      payMode: r.payMode,
      payWeekday: String(r.payWeekday),
      payDay: String(r.payDay),
      diariaValue: r.diariaValue ? String(r.diariaValue).replace(".", ",") : "",
      corridaValue: r.corridaValue ? String(r.corridaValue).replace(".", ",") : "",
      clientIds: [...r.clientIds],
    });
    setCfgMsg("");
  }

  async function persistSettings(patch: Partial<DriverSettings>) {
    if (!ownerId) return;
    await saveDriverSettings({
      ownerId,
      accountId: cfg.accountId || null,
      categoryId: cfg.categoryId || null,
      costCenterId: cfg.costCenterId || null,
      rules: savedRules,
      updatedAt: Date.now(),
      ...patch,
    });
  }

  async function salvarClassificacao() {
    setBusy(true);
    setCfgMsg("");
    try {
      await persistSettings({});
      setCfgMsg("✅ Classificação dos títulos salva.");
      await load();
    } catch (err) {
      setCfgMsg(`❌ Falha ao salvar: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function salvarRegra() {
    if (rule.clientIds.length === 0) return setCfgMsg("Adicione pelo menos um cliente à regra.");
    const payDay = Math.floor(Number(rule.payDay));
    if (rule.payMode === "monthDay" && (!Number.isFinite(payDay) || payDay < 1 || payDay > 31)) {
      return setCfgMsg("Dia do mês entre 1 e 31.");
    }
    const diariaValue = parseBrCurrency(rule.diariaValue) ?? 0;
    const corridaValue = parseBrCurrency(rule.corridaValue) ?? 0;
    if (diariaValue <= 0 && corridaValue <= 0) return setCfgMsg("Informe o valor da diária e/ou da corrida.");
    const id =
      rule.id ||
      (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const saved: PayRule = {
      id,
      payMode: rule.payMode,
      payDay: Number.isFinite(payDay) && payDay >= 1 ? Math.min(31, payDay) : 5,
      payWeekday: Math.floor(Number(rule.payWeekday)) || 0,
      diariaValue,
      corridaValue,
      clientIds: rule.clientIds,
    };
    // Um cliente só pode estar numa regra: sai das outras ao entrar nesta.
    const next = savedRules
      .filter((r) => r.id !== id)
      .map((r) => ({ ...r, clientIds: r.clientIds.filter((c) => !saved.clientIds.includes(c)) }))
      .filter((r) => r.clientIds.length > 0);
    next.push(saved);
    setBusy(true);
    setCfgMsg("");
    try {
      await persistSettings({ rules: next });
      setCfgMsg(`✅ Regra salva para ${saved.clientIds.map((c) => clientName.get(c) ?? "?").join(", ")}.`);
      setRule(emptyRule);
      await load();
    } catch (err) {
      setCfgMsg(`❌ Falha ao salvar: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function removerRegra(r: PayRule) {
    if (!confirm(`Remover a regra de ${r.clientIds.map((c) => clientName.get(c) ?? "?").join(", ")}?`)) return;
    setBusy(true);
    try {
      await persistSettings({ rules: savedRules.filter((x) => x.id !== r.id) });
      if (rule.id === r.id) setRule(emptyRule);
      await load();
    } catch (err) {
      setCfgMsg(`❌ Falha ao remover: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const describeRule = (r: ClientPayRule) =>
    (r.payMode === "weekday" ? `próxima ${WEEKDAY_NAMES[r.payWeekday] ?? "?"}` : `dia ${r.payDay} do mês`) +
    ` · diária ${brl(r.diariaValue)} · corrida ${brl(r.corridaValue)}`;

  // ── Acessos restritos (só o dono) ────────────────────────────────────────
  const [newEmail, setNewEmail] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [memberMsg, setMemberMsg] = useState("");

  async function adicionarAcesso() {
    if (!ownerId) return;
    const email = normalizeEmail(newEmail);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setMemberMsg("Informe um e-mail válido.");
    if (email === normalizeEmail(user?.email ?? "")) return setMemberMsg("Esse é o seu próprio e-mail.");
    setBusy(true);
    setMemberMsg("");
    try {
      await addMember({ ownerId, email, role: "driver", label: newLabel.trim() || null, createdAt: Date.now() });
      setNewEmail("");
      setNewLabel("");
      setMemberMsg(`✅ ${email} liberado. A pessoa cria a conta com esse e-mail na tela de login ("Criar conta") e entra direto aqui.`);
      await load();
    } catch (err) {
      setMemberMsg(`❌ Falha ao liberar: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function removerAcesso(m: Member) {
    if (!confirm(`Remover o acesso de ${m.email}?`)) return;
    setBusy(true);
    try {
      await removeMember(m.email);
      await load();
    } catch (err) {
      setMemberMsg(`❌ Falha ao remover: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return <p className="muted">Carregando…</p>;

  const openRides = rides.filter((r) => !r.billId);

  return (
    <>
      {error && <p className="badge err">{error}</p>}
      {restricted && (
        <p className="muted" style={{ marginTop: 0 }}>
          Acesso restrito: você lança corridas e gera os títulos dos motoristas. Logado como {me}.
        </p>
      )}

      {/* ── Lançar corridas ─────────────────────────────────────────────── */}
      <div className="panel">
        <h2>Lançar corridas</h2>
        {activeDrivers.length === 0 ? (
          <p className="muted">Cadastre um motorista abaixo para começar.</p>
        ) : clients.length === 0 ? (
          <p className="muted">Nenhuma empresa (cliente) cadastrada ainda.</p>
        ) : (
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-end" }}>
            <Field label="Motorista">
              <select value={rDriver} onChange={(e) => setRDriver(e.target.value)}>
                <option value="">Escolha…</option>
                {activeDrivers.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Empresa">
              <select value={rClient} onChange={(e) => setRClient(e.target.value)}>
                <option value="">Escolha…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Data">
              <DateParts value={rDate} onChange={setRDate} />
            </Field>
            <Field label="Diárias">
              <input
                type="number"
                min={0}
                value={rDiarias}
                onChange={(e) => setRDiarias(e.target.value)}
                style={{ ...fieldStyle, width: 80 }}
              />
            </Field>
            <Field label="Corridas">
              <input
                type="number"
                min={0}
                value={rCorridas}
                onChange={(e) => setRCorridas(e.target.value)}
                placeholder="0"
                style={{ ...fieldStyle, width: 90 }}
              />
            </Field>
            <Field label="Observações">
              <input
                value={rNotes}
                onChange={(e) => setRNotes(e.target.value)}
                style={{ ...fieldStyle, minWidth: 160 }}
              />
            </Field>
            <button className="btn-primary" disabled={busy} onClick={() => void lancar()}>
              Lançar
            </button>
          </div>
        )}
        {rideMsg && (
          <p style={{ marginBottom: 0 }}>
            <span className={`badge ${rideMsg.startsWith("✅") ? "ok" : "warn"}`}>{rideMsg}</span>
          </p>
        )}
      </div>

      {/* ── Motoristas + títulos ────────────────────────────────────────── */}
      <div className="panel">
        <h2>Motoristas</h2>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-end" }}>
          <Field label="Novo motorista">
            <input
              value={newDriver}
              onChange={(e) => setNewDriver(e.target.value)}
              placeholder="Nome"
              style={{ ...fieldStyle, minWidth: 200 }}
            />
          </Field>
          <button disabled={busy} onClick={() => void cadastrarMotorista()}>Cadastrar</button>
        </div>
        {driverMsg && (
          <p>
            <span className={`badge ${driverMsg.startsWith("✅") ? "ok" : "warn"}`}>{driverMsg}</span>
          </p>
        )}
        {(() => {
          const semRegra = [...new Set(rides.filter((r) => !r.billId).map((r) => r.clientId))].filter(
            (cid) => !ruleForClient(settings, cid),
          );
          if (semRegra.length === 0) return null;
          return (
            <p className="badge warn" style={{ display: "inline-block" }}>
              ⚠ Sem regra de pagamento: {semRegra.map((cid) => clientName.get(cid) ?? "?").join(", ")}.{" "}
              {restricted
                ? "O dono precisa configurar a regra dessa(s) empresa(s) para gerar o título."
                : "Configure abaixo, em \"Regras de pagamento\", para gerar os títulos."}
            </p>
          );
        })()}
        {drivers.length === 0 ? (
          <p className="muted">Nenhum motorista cadastrado.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Motorista</th>
                  <th>Empresa</th>
                  <th style={{ textAlign: "right" }}>Diárias em aberto</th>
                  <th style={{ textAlign: "right" }}>Corridas em aberto</th>
                  <th style={{ textAlign: "right" }}>A pagar</th>
                  <th>Vence</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {drivers.map((d) => {
                  const clientIds = [
                    ...new Set(rides.filter((r) => r.driverId === d.id && !r.billId).map((r) => r.clientId)),
                  ].sort((a, b) => (clientName.get(a) ?? "").localeCompare(clientName.get(b) ?? "", "pt-BR"));
                  if (clientIds.length === 0) {
                    return (
                      <tr key={d.id}>
                        <td>{d.name}</td>
                        <td className="muted" colSpan={5}>sem corridas em aberto</td>
                        <td>
                          <button
                            style={{ background: "var(--err)", padding: "0.3rem 0.6rem" }}
                            disabled={busy}
                            onClick={() => void excluirMotorista(d)}
                          >
                            Excluir
                          </button>
                        </td>
                      </tr>
                    );
                  }
                  return clientIds.map((cid, i) => {
                    const r = ruleForClient(settings, cid);
                    const p = computeDriverPayout(rides, d.id!, cid, r ?? { diariaValue: 0, corridaValue: 0 });
                    return (
                      <tr key={`${d.id}-${cid}`}>
                        <td>{i === 0 ? d.name : ""}</td>
                        <td>{clientName.get(cid) ?? "—"}</td>
                        <td style={{ textAlign: "right" }}>{p.diarias}</td>
                        <td style={{ textAlign: "right" }}>{p.corridas}</td>
                        <td style={{ textAlign: "right", fontWeight: 600 }}>
                          {r ? brl(p.total) : <span className="muted">sem regra</span>}
                        </td>
                        <td className="muted" style={{ whiteSpace: "nowrap" }}>
                          {r ? describeDue(todayBr(), payDueDate(todayBr(), r)) : "—"}
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <button
                            className="btn-primary"
                            disabled={busy || !r || p.rideIds.length === 0}
                            onClick={() => abrirPagamento(d.id!, cid)}
                          >
                            Gerar título a pagar
                          </button>
                        </td>
                      </tr>
                    );
                  });
                })}
              </tbody>
            </table>
          </div>
        )}

        {payTarget && payout && payRule && (
          <div
            style={{
              marginTop: "0.75rem",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "0.75rem",
            }}
          >
            <strong>
              Título a pagar — {driverName.get(payTarget.driverId)} · {clientName.get(payTarget.clientId)}
            </strong>
            <div className="muted" style={{ fontSize: "0.85rem", margin: "0.3rem 0" }}>
              {payout.period ? `Período ${payout.period}. ` : ""}Regra da empresa: {describeRule(payRule)}.
            </div>
            <div>
              {payout.diarias} diária(s) × {brl(payRule.diariaValue)} = <strong>{brl(payout.diariasValor)}</strong>
              {" · "}
              {payout.corridas} corrida(s) × {brl(payRule.corridaValue)} = <strong>{brl(payout.corridasValor)}</strong>
            </div>
            <div style={{ fontSize: "1.1rem", margin: "0.3rem 0" }}>
              Total: <strong style={{ color: "var(--err)" }}>{brl(payout.total)}</strong>
            </div>
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", flexWrap: "wrap" }}>
              <Field label={`Vencimento: ${describeDue(todayBr(), payDue)}`}>
                <DateParts value={payDue} onChange={setPayDue} />
              </Field>
              <button className="btn-primary" disabled={busy} onClick={() => void gerarTitulo()}>
                Confirmar e gerar título
              </button>
              <button style={{ background: "var(--border)" }} onClick={() => setPayTarget(null)}>
                Cancelar
              </button>
            </div>
          </div>
        )}
        {payMsg && (
          <p style={{ marginBottom: 0 }}>
            <span className={`badge ${payMsg.startsWith("✅") ? "ok" : "warn"}`}>{payMsg}</span>
          </p>
        )}
      </div>

      {/* ── Lançamentos recentes ────────────────────────────────────────── */}
      <div className="panel">
        <h2>Corridas lançadas</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {openRides.length} em aberto (ainda sem título) de {rides.length} no total.
        </p>
        {rides.length === 0 ? (
          <p className="muted">Nenhuma corrida lançada ainda.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Motorista</th>
                  <th>Empresa</th>
                  <th style={{ textAlign: "right" }}>Diárias</th>
                  <th style={{ textAlign: "right" }}>Corridas</th>
                  <th>Obs.</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rides.slice(0, 60).map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{brDate(r.date)}</td>
                    <td>{driverName.get(r.driverId) ?? "—"}</td>
                    <td>{clientName.get(r.clientId) ?? "—"}</td>
                    <td style={{ textAlign: "right" }}>{r.diarias}</td>
                    <td style={{ textAlign: "right" }}>{r.corridas}</td>
                    <td className="muted">{r.notes ?? ""}</td>
                    <td>
                      {r.billId ? (
                        <span style={{ color: "var(--ok)", fontWeight: 600 }}>Em título</span>
                      ) : (
                        <span className="muted">Em aberto</span>
                      )}
                    </td>
                    <td>
                      {!r.billId && (
                        <button
                          style={{ background: "var(--err)", padding: "0.3rem 0.6rem" }}
                          disabled={busy}
                          onClick={() => void excluirRide(r)}
                        >
                          Excluir
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rides.length > 60 && (
              <p className="muted" style={{ fontSize: "0.8rem" }}>Mostrando os 60 mais recentes.</p>
            )}
          </div>
        )}
      </div>

      {/* ── Só o dono: configuração e acessos ───────────────────────────── */}
      {!restricted && (
        <>
          <div className="panel">
            <h2>Configuração de pagamento</h2>
            <h3 style={{ marginBottom: "0.25rem" }}>Regras de pagamento</h3>
            <p className="muted" style={{ marginTop: 0, fontSize: "0.85rem" }}>
              Cada regra diz quando vence e quanto você paga por diária e por corrida — e vale para os
              clientes que você adicionar nela (um ou vários). Gerado no próprio dia da semana, vence hoje.
            </p>
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-end" }}>
              <Field label="Vencimento">
                <select
                  value={rule.payMode}
                  onChange={(e) => setRule({ ...rule, payMode: e.target.value as "monthDay" | "weekday" })}
                >
                  <option value="weekday">Próximo dia da semana</option>
                  <option value="monthDay">Dia fixo do mês</option>
                </select>
              </Field>
              {rule.payMode === "monthDay" ? (
                <Field label="Dia do mês (1–31)">
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={rule.payDay}
                    onChange={(e) => setRule({ ...rule, payDay: e.target.value })}
                    style={{ ...fieldStyle, width: 80 }}
                  />
                </Field>
              ) : (
                <Field label="Dia da semana">
                  <select value={rule.payWeekday} onChange={(e) => setRule({ ...rule, payWeekday: e.target.value })}>
                    {WEEKDAY_NAMES.map((n, i) => (
                      <option key={n} value={i}>{n}</option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="Cliente">
                <span style={{ display: "inline-flex", gap: "0.4rem" }}>
                  <select value={ruleClientPick} onChange={(e) => setRuleClientPick(e.target.value)}>
                    <option value="">Escolha…</option>
                    {clients
                      .filter((c) => !rule.clientIds.includes(c.id!))
                      .map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                  </select>
                  <button
                    type="button"
                    disabled={!ruleClientPick}
                    onClick={() => {
                      if (!ruleClientPick) return;
                      setRule({ ...rule, clientIds: [...rule.clientIds, ruleClientPick] });
                      setRuleClientPick("");
                    }}
                  >
                    + Adicionar
                  </button>
                </span>
              </Field>
              <Field label="Valor pago por diária (R$)">
                <input
                  value={rule.diariaValue}
                  onChange={(e) => setRule({ ...rule, diariaValue: e.target.value })}
                  placeholder="ex.: 70"
                  style={{ ...fieldStyle, width: 110, textAlign: "right" }}
                />
              </Field>
              <Field label="Valor pago por corrida (R$)">
                <input
                  value={rule.corridaValue}
                  onChange={(e) => setRule({ ...rule, corridaValue: e.target.value })}
                  placeholder="ex.: 8"
                  style={{ ...fieldStyle, width: 110, textAlign: "right" }}
                />
              </Field>
              <button className="btn-primary" disabled={busy} onClick={() => void salvarRegra()}>
                {rule.id ? "Atualizar regra" : "Salvar regra"}
              </button>
              {rule.id && (
                <button style={{ background: "var(--border)" }} onClick={() => setRule(emptyRule)}>
                  Cancelar edição
                </button>
              )}
            </div>
            {rule.clientIds.length > 0 && (
              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
                <span className="muted" style={{ fontSize: "0.82rem" }}>Clientes desta regra:</span>
                {rule.clientIds.map((cid) => (
                  <span
                    key={cid}
                    className="badge"
                    style={{ background: "var(--border)", color: "var(--text)", display: "inline-flex", gap: 6 }}
                  >
                    {clientName.get(cid) ?? "?"}
                    <button
                      type="button"
                      title="Tirar da regra"
                      onClick={() => setRule({ ...rule, clientIds: rule.clientIds.filter((c) => c !== cid) })}
                      style={{ background: "transparent", border: "none", color: "var(--err)", padding: 0, cursor: "pointer" }}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
            {savedRules.length > 0 && (
              <div style={{ overflowX: "auto", marginTop: "0.75rem" }}>
                <table>
                  <thead>
                    <tr>
                      <th>Clientes</th>
                      <th>Vencimento</th>
                      <th style={{ textAlign: "right" }}>Diária</th>
                      <th style={{ textAlign: "right" }}>Corrida</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {savedRules.map((r) => (
                      <tr key={r.id}>
                        <td>{r.clientIds.map((c) => clientName.get(c) ?? "(excluído)").join(", ")}</td>
                        <td>{r.payMode === "weekday" ? `próxima ${WEEKDAY_NAMES[r.payWeekday] ?? "?"}` : `dia ${r.payDay} do mês`}</td>
                        <td style={{ textAlign: "right" }}>{brl(r.diariaValue)}</td>
                        <td style={{ textAlign: "right" }}>{brl(r.corridaValue)}</td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <button
                            style={{ background: "var(--border)", padding: "0.3rem 0.6rem" }}
                            disabled={busy}
                            onClick={() => editarRegra(r)}
                          >
                            Editar
                          </button>{" "}
                          <button
                            style={{ background: "var(--err)", padding: "0.3rem 0.6rem" }}
                            disabled={busy}
                            onClick={() => void removerRegra(r)}
                          >
                            Remover
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <h3 style={{ marginBottom: "0.25rem", marginTop: "1rem" }}>Classificação dos títulos</h3>
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-end" }}>
              <Field label="Conta do título">
                <select value={cfg.accountId} onChange={(e) => setCfg({ ...cfg, accountId: e.target.value })}>
                  <option value="">—</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Centro de custo">
                <select value={cfg.costCenterId} onChange={(e) => setCfg({ ...cfg, costCenterId: e.target.value })}>
                  <option value="">—</option>
                  {costCenters.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Categoria (despesa)">
                <select value={cfg.categoryId} onChange={(e) => setCfg({ ...cfg, categoryId: e.target.value })}>
                  <option value="">—</option>
                  {categories
                    .filter((c) => !cfg.costCenterId || (c.costCenterId ?? "") === cfg.costCenterId || !!c.parentId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>{c.parentId ? `  ↳ ${c.name}` : c.name}</option>
                    ))}
                </select>
              </Field>
              <button disabled={busy} onClick={() => void salvarClassificacao()}>Salvar classificação</button>
            </div>
            {cfgMsg && (
              <p style={{ marginBottom: 0 }}>
                <span className={`badge ${cfgMsg.startsWith("✅") ? "ok" : "warn"}`}>{cfgMsg}</span>
              </p>
            )}
          </div>

          <div className="panel">
            <h2>Acessos restritos</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              E-mails liberados aqui entram no app e enxergam <strong>só esta tela</strong>. A pessoa cria a
              conta com o e-mail liberado na tela de login (&quot;Criar conta&quot;) — ou entra com o Google,
              se for um e-mail Google.
            </p>
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-end" }}>
              <Field label="E-mail">
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="pessoa@exemplo.com"
                  style={{ ...fieldStyle, minWidth: 220 }}
                />
              </Field>
              <Field label="Nome / apelido (opcional)">
                <input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  style={{ ...fieldStyle, minWidth: 160 }}
                />
              </Field>
              <button disabled={busy} onClick={() => void adicionarAcesso()}>Liberar acesso</button>
            </div>
            {memberMsg && (
              <p>
                <span className={`badge ${memberMsg.startsWith("✅") ? "ok" : "warn"}`}>{memberMsg}</span>
              </p>
            )}
            {members.length > 0 && (
              <ul style={{ paddingLeft: "1.2rem", marginBottom: 0 }}>
                {members.map((m) => (
                  <li key={m.email} style={{ margin: "0.25rem 0" }}>
                    {m.email}
                    {m.label ? <span className="muted"> — {m.label}</span> : null}{" "}
                    <button
                      style={{ background: "transparent", color: "var(--err)", border: "none", padding: 0, cursor: "pointer" }}
                      disabled={busy}
                      onClick={() => void removerAcesso(m)}
                      title="Remover acesso"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
      <span className="muted" style={{ fontSize: "0.8rem" }}>{label}</span>
      {children}
    </label>
  );
}

const fieldStyle: React.CSSProperties = {
  padding: "0.35rem 0.5rem",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
  font: "inherit",
};
