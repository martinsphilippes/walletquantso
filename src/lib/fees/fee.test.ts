import { describe, it, expect } from "vitest";
import {
  computeFee,
  describeFee,
  feeAccountFor,
  feeApplies,
  feeFromRealized,
  learnedPercent,
  linkedChargesFor,
  mainAmount,
  realizedFromFee,
} from "./fee";
import type { Account, AccountFee } from "@/types";

const fee: AccountFee = {
  percent: 2,
  fixed: 1,
  onIncome: true,
  onExpense: true,
  onTransfer: true,
  categoryId: "taxa",
  costCenterId: "cc",
};
const acc = (id: string, f: AccountFee | null = null): Account => ({
  id,
  ownerId: "u",
  name: id,
  type: "checking",
  initialBalance: 0,
  currency: "BRL",
  archived: false,
  createdAt: 0,
  fee: f,
});
const accounts = [acc("depix", fee), acc("c6"), acc("cora")];

describe("taxa de conta", () => {
  it("calcula percentual + fixo e o realizado por tipo (quem paga é o dono)", () => {
    expect(computeFee(100, fee)).toBe(3);
    expect(realizedFromFee("expense", 100, 3)).toBe(103); // sai valor + taxa
    expect(realizedFromFee("income", 100, 3)).toBe(97); // entra valor − taxa
    expect(realizedFromFee("transfer", 100, 3)).toBe(97); // chega valor − taxa
  });

  it("taxa a partir do realizado digitado", () => {
    expect(feeFromRealized("expense", 100, 104.5)).toBe(4.5);
    expect(feeFromRealized("income", 100, 96)).toBe(4);
  });

  it("aprende o percentual mantendo o fixo", () => {
    expect(learnedPercent(100, 4, 1)).toBe(3);
    expect(learnedPercent(250, 6.25, 0)).toBe(2.5);
    expect(learnedPercent(100, 0.5, 1)).toBe(0); // nunca negativo
    expect(learnedPercent(0, 3, 1)).toBe(0);
  });

  it("vale só nas operações marcadas e com algum valor", () => {
    expect(feeApplies({ ...fee, onIncome: false }, "income")).toBe(false);
    expect(feeApplies({ ...fee, percent: 0, fixed: 0 }, "expense")).toBe(false);
    expect(feeApplies(null, "expense")).toBe(false);
  });

  it("escolhe a conta da taxa: a da operação; na transferência, origem e depois destino", () => {
    expect(feeAccountFor("expense", "depix", null, accounts)?.account.id).toBe("depix");
    expect(feeAccountFor("expense", "c6", null, accounts)).toBeNull();
    expect(feeAccountFor("transfer", "depix", "c6", accounts)).toMatchObject({ isSource: true });
    expect(feeAccountFor("transfer", "c6", "depix", accounts)).toMatchObject({ isSource: false });
    expect(feeAccountFor("transfer", "c6", "cora", accounts)).toBeNull();
  });

  it("valor do principal: líquido só na transferência que sai da conta com taxa", () => {
    expect(mainAmount("transfer", 100, 3, true)).toBe(97);
    expect(mainAmount("transfer", 100, 3, false)).toBe(100);
    expect(mainAmount("expense", 100, 3, true)).toBe(100);
  });

  it("descreve a taxa", () => {
    expect(describeFee(fee).replace(/ /g, " ")).toBe("2% + R$ 1,00");
    expect(describeFee({ ...fee, fixed: 0, percent: 2.35 })).toBe("2,35%");
  });
});

describe("regras vinculadas (gasto em outra conta)", () => {
  const depix: Account = {
    ...acc("depix", fee),
    linkedFees: [
      { id: "r1", accountId: "lbtc", percent: 1, fixed: 0.5, onIncome: true, onExpense: true, onTransfer: false, categoryId: "c", costCenterId: null },
      { id: "r2", accountId: "depix", percent: 5, fixed: 0, onIncome: true, onExpense: true, onTransfer: true, categoryId: null, costCenterId: null }, // própria conta: ignorada
      { id: "r3", accountId: "c6", percent: 0, fixed: 0, onIncome: true, onExpense: true, onTransfer: true, categoryId: null, costCenterId: null }, // zero: ignorada
    ],
  };
  const all = [depix, acc("lbtc"), acc("c6")];

  it("despesa na Depix gera gasto na L-BTC (percentual + fixo)", () => {
    const ch = linkedChargesFor("expense", "depix", null, 200, all);
    expect(ch).toHaveLength(1);
    expect(ch[0].targetAccount?.id).toBe("lbtc");
    expect(ch[0].amount).toBe(2.5);
  });

  it("respeita o tipo de operação e, na transferência, olha origem e destino", () => {
    expect(linkedChargesFor("transfer", "depix", "c6", 200, all)).toHaveLength(0);
    expect(linkedChargesFor("transfer", "c6", "depix", 200, all)).toHaveLength(0);
    const withTransfer = [{ ...depix, linkedFees: [{ ...depix.linkedFees![0], onTransfer: true }] }, acc("lbtc"), acc("c6")];
    expect(linkedChargesFor("transfer", "c6", "depix", 100, withTransfer)[0].amount).toBe(1.5);
  });

  it("conta sem regra não gera nada", () => {
    expect(linkedChargesFor("expense", "c6", null, 200, all)).toHaveLength(0);
  });
});
