// WalletQuantso — configuração do Telegram pelo app (dono logado).
//
// GET  /api/telegram/settings           — estado da vinculação + link t.me.
// POST /api/telegram/settings {action}  — "link" (novo código + registra o
//      webhook), "send" (manda o relatório agora), "enable"/"disable"
//      (envio diário), "unlink" (desvincula).
// Autenticado pelo ID token do Firebase (Authorization: Bearer <token>).

import { NextResponse } from "next/server";
import { verifyIdToken } from "@/server/firebase-admin";
import {
  botUsername,
  getSettings,
  newLinkCode,
  saveSettings,
  sendPayablesReport,
  setWebhook,
} from "@/server/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function uidFrom(req: Request): Promise<string> {
  const auth = req.headers.get("authorization") || "";
  const idToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!idToken) throw new Error("Faça login para configurar o Telegram.");
  return (await verifyIdToken(idToken)).uid;
}

function configured(): string | null {
  if (!process.env.TELEGRAM_BOT_TOKEN) return "TELEGRAM_BOT_TOKEN não configurado no servidor (Vercel).";
  if (!process.env.TELEGRAM_WEBHOOK_SECRET) return "TELEGRAM_WEBHOOK_SECRET não configurado no servidor (Vercel).";
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) return "FIREBASE_SERVICE_ACCOUNT não configurado no servidor (Vercel).";
  return null;
}

async function state(ownerId: string) {
  const s = await getSettings(ownerId);
  let username: string | null = null;
  try {
    username = await botUsername();
  } catch {
    username = null;
  }
  return {
    configured: configured(),
    botUsername: username,
    linked: !!s?.chatId,
    chatName: s?.chatName ?? null,
    enabled: !!s?.enabled,
    linkCode: s?.linkCode ?? null,
    linkUrl: username && s?.linkCode ? `https://t.me/${username}?start=${s.linkCode}` : null,
    lastSentAt: s?.lastSentAt ?? null,
    lastError: s?.lastError ?? null,
  };
}

export async function GET(req: Request) {
  try {
    const uid = await uidFrom(req);
    return NextResponse.json(await state(uid));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
}

export async function POST(req: Request) {
  let uid: string;
  try {
    uid = await uidFrom(req);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }
  try {
    const missing = configured();
    if (missing) throw new Error(missing);
    const { action } = (await req.json()) as { action: string };
    if (action === "link") {
      const base = new URL(req.url).origin;
      await setWebhook(base);
      await newLinkCode(uid);
    } else if (action === "send") {
      const n = await sendPayablesReport(uid);
      return NextResponse.json({ ok: true, messages: n, ...(await state(uid)) });
    } else if (action === "enable" || action === "disable") {
      await saveSettings(uid, { enabled: action === "enable" });
    } else if (action === "unlink") {
      await saveSettings(uid, { chatId: null, chatName: null, enabled: false, linkCode: null });
    } else {
      throw new Error("Ação desconhecida.");
    }
    return NextResponse.json({ ok: true, ...(await state(uid)) });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
}
