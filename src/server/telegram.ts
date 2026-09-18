// WalletQuantso — Telegram (server-only).
//
// Fala com a Bot API usando o token do robô (TELEGRAM_BOT_TOKEN, só no
// servidor). Guarda a vinculação de cada dono em telegramSettings/{ownerId}
// via Admin SDK: o navegador nunca lê essa coleção diretamente, então as
// regras do Firestore não precisam mudar.

import crypto from "node:crypto";
import { getAdminDb } from "./firebase-admin";
import { buildPayablesMessages } from "@/lib/reports/payables-telegram";
import { buildExpensesMessages } from "@/lib/reports/expenses-telegram";
import { todayBr } from "@/lib/br/date";
import type { Account, Bill, Category, Transaction } from "@/types";

export interface TelegramSettings {
  ownerId: string;
  /** Chat vinculado (null até a pessoa mandar /start com o código). */
  chatId: string | null;
  chatName?: string | null;
  /** Código de uma vez usado no link t.me/<bot>?start=<código>. */
  linkCode: string | null;
  /** Envio diário ligado. */
  enabled: boolean;
  linkedAt?: number | null;
  lastSentAt?: number | null;
  lastError?: string | null;
  updatedAt: number;
}

const COLLECTION = "telegramSettings";

function token(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN não configurado no servidor.");
  return t;
}

async function api<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!json.ok) throw new Error(`Telegram: ${json.description ?? res.statusText}`);
  return json.result as T;
}

/** Envia uma mensagem em HTML. */
export async function sendMessage(chatId: string, html: string): Promise<void> {
  await api("sendMessage", {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}

/** Nome de usuário do robô (para montar o link t.me/...). */
export async function botUsername(): Promise<string> {
  const me = await api<{ username?: string }>("getMe", {});
  if (!me.username) throw new Error("O robô não tem nome de usuário.");
  return me.username;
}

/** Registra o webhook do robô apontando para este app. */
export async function setWebhook(baseUrl: string): Promise<void> {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) throw new Error("TELEGRAM_WEBHOOK_SECRET não configurado no servidor.");
  await api("setWebhook", {
    url: `${baseUrl}/api/telegram/webhook`,
    secret_token: secret,
    allowed_updates: ["message"],
    drop_pending_updates: true,
  });
}

export async function getSettings(ownerId: string): Promise<TelegramSettings | null> {
  const snap = await getAdminDb().collection(COLLECTION).doc(ownerId).get();
  return snap.exists ? (snap.data() as TelegramSettings) : null;
}

export async function saveSettings(ownerId: string, patch: Partial<TelegramSettings>): Promise<void> {
  await getAdminDb()
    .collection(COLLECTION)
    .doc(ownerId)
    .set({ ownerId, updatedAt: Date.now(), ...patch }, { merge: true });
}

/** Gera (ou renova) o código de vinculação do dono. */
export async function newLinkCode(ownerId: string): Promise<string> {
  const code = crypto.randomBytes(9).toString("base64url");
  await saveSettings(ownerId, { linkCode: code });
  return code;
}

/** Vincula o chat que mandou /start <código>; devolve o dono ou null. */
export async function linkByCode(code: string, chatId: string, chatName: string | null): Promise<string | null> {
  const db = getAdminDb();
  const snap = await db.collection(COLLECTION).where("linkCode", "==", code).limit(1).get();
  if (snap.empty) return null;
  const ownerId = snap.docs[0].id;
  await saveSettings(ownerId, {
    chatId,
    chatName,
    linkCode: null,
    enabled: true,
    linkedAt: Date.now(),
    lastError: null,
  });
  return ownerId;
}

/** Dono vinculado a um chat (para comandos vindos do Telegram). */
export async function ownerByChat(chatId: string): Promise<TelegramSettings | null> {
  const snap = await getAdminDb().collection(COLLECTION).where("chatId", "==", chatId).limit(1).get();
  return snap.empty ? null : (snap.docs[0].data() as TelegramSettings);
}

/** Monta o relatório "contas a pagar por conta" do dono com o Admin SDK. */
export async function payablesReport(ownerId: string): Promise<string[]> {
  const db = getAdminDb();
  const [billsSnap, accountsSnap] = await Promise.all([
    db.collection("bills").where("ownerId", "==", ownerId).get(),
    db.collection("accounts").where("ownerId", "==", ownerId).get(),
  ]);
  const bills = billsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as Bill);
  const accounts = accountsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as Account);
  return buildPayablesMessages(bills, accounts, todayBr());
}

/** Monta o relatório "gastos do mês por categoria" do dono. */
export async function expensesReport(ownerId: string): Promise<string[]> {
  const db = getAdminDb();
  const [txSnap, catSnap] = await Promise.all([
    db.collection("transactions").where("ownerId", "==", ownerId).get(),
    db.collection("categories").where("ownerId", "==", ownerId).get(),
  ]);
  const txs = txSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as Transaction);
  const cats = catSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as Category);
  return buildExpensesMessages(txs, cats, todayBr());
}

export type ReportKind = "payables" | "expenses" | "all";

/** Envia o(s) relatório(s) ao chat vinculado do dono. Devolve quantas mensagens. */
export async function sendReports(ownerId: string, kind: ReportKind = "all"): Promise<number> {
  const s = await getSettings(ownerId);
  if (!s?.chatId) throw new Error("Telegram ainda não vinculado.");
  const messages: string[] = [];
  if (kind === "payables" || kind === "all") messages.push(...(await payablesReport(ownerId)));
  if (kind === "expenses" || kind === "all") messages.push(...(await expensesReport(ownerId)));
  try {
    for (const m of messages) await sendMessage(s.chatId, m);
    await saveSettings(ownerId, { lastSentAt: Date.now(), lastError: null });
  } catch (err) {
    await saveSettings(ownerId, { lastError: (err as Error).message });
    throw err;
  }
  return messages.length;
}

/** Compatibilidade: só as contas a pagar. */
export function sendPayablesReport(ownerId: string): Promise<number> {
  return sendReports(ownerId, "payables");
}

/** Envio diário (contas a pagar + gastos por categoria) a todos os donos vinculados. */
export async function runDailyPayables(): Promise<{
  owners: number;
  details: Array<{ ownerId: string; messages?: number; error?: string }>;
}> {
  const snap = await getAdminDb().collection(COLLECTION).where("enabled", "==", true).get();
  const details: Array<{ ownerId: string; messages?: number; error?: string }> = [];
  for (const doc of snap.docs) {
    const s = doc.data() as TelegramSettings;
    if (!s.chatId) continue;
    try {
      details.push({ ownerId: doc.id, messages: await sendReports(doc.id, "all") });
    } catch (err) {
      details.push({ ownerId: doc.id, error: (err as Error).message });
    }
  }
  return { owners: details.length, details };
}
