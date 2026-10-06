"use client";

// Campos de taxa da conta (ex.: Depix) para qualquer tela que gere um
// lançamento: "Taxa" e "Valor realizado", calculados pela configuração da
// conta e editáveis. Corrigir um deles marca a decisão como "aprendida": o
// novo percentual passa a valer na conta nos próximos lançamentos.
//
// O componente é controlado: a tela guarda `FeeState` e usa `resolveFee`
// para montar o que vai para o serviço (`{ accountId, amount, learn }` ou
// null quando a conta não cobra taxa nesta operação).

import { useState } from "react";
import { maskBrAmount, parseBrCurrency } from "@/lib/br/parse";
import {
  computeFee,
  describeFee,
  feeAccountFor,
  feeFromRealized,
  learnedPercent,
  linkedChargesFor,
  realizedFromFee,
} from "@/lib/fees/fee";
import type { Account, TransactionType } from "@/types";

export interface FeeState {
  /** null = calculada pela conta; número = valor fixado pelo usuário. */
  override: number | null;
  /** O usuário digitou na taxa ou no realizado (→ aprende o percentual). */
  typed: boolean;
}

export const FEE_AUTO: FeeState = { override: null, typed: false };

export interface FeeDecision {
  accountId: string;
  amount: number;
  learn: boolean;
}

/** Decisão da taxa para o serviço: objeto quando a conta cobra, senão null. */
export function resolveFee(
  type: TransactionType,
  accountId: string,
  transferAccountId: string | null,
  gross: number,
  accounts: Account[],
  state: FeeState,
): FeeDecision | null {
  const target = feeAccountFor(type, accountId, transferAccountId, accounts);
  const cfg = target?.account.fee;
  if (!target || !cfg) return null;
  const auto = computeFee(gross, cfg);
  const amount = Math.max(0, state.override ?? auto);
  const learn = state.typed && gross > 0 && Math.abs(amount - auto) > 0.005;
  return { accountId: target.account.id!, amount, learn };
}

const fmt2 = (n: number) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Aviso dos gastos em OUTRAS contas que esta operação vai gerar (regras
 * vinculadas, ex.: Depix → L-BTC). Nada a editar: é pela configuração.
 */
export function LinkedFeeNote({
  type,
  accountId,
  transferAccountId = null,
  gross,
  accounts,
}: {
  type: TransactionType;
  accountId: string;
  transferAccountId?: string | null;
  gross: number;
  accounts: Account[];
}) {
  const charges = linkedChargesFor(type, accountId, transferAccountId, gross, accounts);
  if (charges.length === 0) return null;
  return (
    <div
      className="muted"
      style={{
        flexBasis: "100%",
        fontSize: "0.8rem",
        padding: "0.4rem 0.6rem",
        border: "1px dashed var(--border)",
        borderRadius: 8,
      }}
    >
      Gasto automático em outra conta:{" "}
      {charges.map((c, i) => (
        <span key={c.rule.id}>
          {i > 0 ? " · " : ""}
          <strong>{c.targetAccount?.name ?? "?"}</strong> {brl(c.amount)}{" "}
          <span style={{ opacity: 0.8 }}>(regra da {c.sourceAccount.name})</span>
        </span>
      ))}
      . Lançado à parte e removido junto se este lançamento for excluído.
    </div>
  );
}

export function FeeFields({
  type,
  accountId,
  transferAccountId = null,
  gross,
  accounts,
  state,
  onChange,
  compact = false,
}: {
  type: TransactionType;
  accountId: string;
  transferAccountId?: string | null;
  gross: number;
  accounts: Account[];
  state: FeeState;
  onChange: (next: FeeState) => void;
  /** Versão enxuta para linhas de tabela (baixas). */
  compact?: boolean;
}) {
  const [focus, setFocus] = useState<"fee" | "realized" | null>(null);
  const [text, setText] = useState("");

  const target = feeAccountFor(type, accountId, transferAccountId, accounts);
  const cfg = target?.account.fee;
  if (!target || !cfg) return null;

  const auto = computeFee(gross, cfg);
  const fee = Math.max(0, state.override ?? auto);
  const realized = realizedFromFee(type, gross, fee);
  const learned = state.typed && gross > 0 && Math.abs(fee - auto) > 0.005;
  const newPercent = learned ? learnedPercent(gross, fee, cfg.fixed ?? 0) : null;

  const realizedLabel =
    type === "expense"
      ? "Valor realizado (sai da conta)"
      : type === "income"
        ? "Valor realizado (entra na conta)"
        : "Valor realizado (chega no destino)";

  const input: React.CSSProperties = {
    padding: compact ? "0.3rem 0.45rem" : "0.35rem 0.5rem",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--panel, var(--bg))",
    color: "var(--text)",
    font: "inherit",
    textAlign: "right",
    width: compact ? 110 : undefined,
  };
  const col: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "0.2rem",
    flex: compact ? "0 0 auto" : "1 1 160px",
  };

  return (
    <div
      style={{
        display: "flex",
        gap: compact ? "0.6rem" : "0.75rem",
        flexWrap: "wrap",
        alignItems: "flex-end",
        padding: compact ? "0.45rem 0.6rem" : "0.6rem 0.75rem",
        border: "1px dashed var(--border)",
        borderRadius: 8,
        flexBasis: compact ? "100%" : undefined,
      }}
    >
      <label style={col}>
        <span className="muted" style={{ fontSize: "0.8rem" }}>
          Taxa {target.account.name} ({describeFee(cfg)})
        </span>
        <input
          value={focus === "fee" ? text : fmt2(fee)}
          onFocus={() => {
            setFocus("fee");
            setText(fmt2(fee));
          }}
          onBlur={() => setFocus(null)}
          onChange={(e) => {
            const m = maskBrAmount(e.target.value);
            setText(m);
            onChange({ override: parseBrCurrency(m) ?? 0, typed: true });
          }}
          inputMode="numeric"
          style={input}
        />
      </label>
      <label style={col}>
        <span className="muted" style={{ fontSize: "0.8rem" }}>{realizedLabel}</span>
        <input
          value={focus === "realized" ? text : fmt2(realized)}
          onFocus={() => {
            setFocus("realized");
            setText(fmt2(realized));
          }}
          onBlur={() => setFocus(null)}
          onChange={(e) => {
            const m = maskBrAmount(e.target.value);
            setText(m);
            const r = parseBrCurrency(m) ?? 0;
            onChange({ override: Math.max(0, feeFromRealized(type, gross, r)), typed: true });
          }}
          inputMode="numeric"
          style={{ ...input, fontWeight: 700 }}
        />
      </label>
      <div className="muted" style={{ flex: "2 1 220px", fontSize: "0.78rem" }}>
        {newPercent != null ? (
          <>
            Nova taxa:{" "}
            <strong style={{ color: "var(--warn)" }}>
              {newPercent.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%
            </strong>
            {(cfg.fixed ?? 0) > 0 ? " + fixo" : ""} — passa a valer nos próximos lançamentos.{" "}
            <button
              type="button"
              onClick={() => onChange(FEE_AUTO)}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--focus)",
                padding: 0,
                cursor: "pointer",
                font: "inherit",
              }}
            >
              usar a taxa da conta
            </button>
          </>
        ) : (
          <>A taxa vira um lançamento à parte. Edite a taxa ou o realizado se o valor real for outro.</>
        )}
      </div>
    </div>
  );
}
