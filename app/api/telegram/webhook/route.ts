// WalletQuantso — webhook do robô do Telegram.
//
// POST /api/telegram/webhook — o Telegram chama aqui a cada mensagem enviada
// ao robô. Validado pelo cabeçalho X-Telegram-Bot-Api-Secret-Token (o mesmo
// TELEGRAM_WEBHOOK_SECRET passado no setWebhook).
//
// Comandos:
//   /start <código>  — vincula este chat ao dono que gerou o código no app.
//   /contas          — manda agora as contas a pagar por conta.

import { NextResponse } from "next/server";
import { linkByCode, ownerByChat, sendMessage, sendPayablesReport } from "@/server/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Update {
  message?: {
    text?: string;
    chat: { id: number | string; first_name?: string; username?: string; title?: string };
  };
}

export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  // Sempre responde 200 ao Telegram (senão ele reenvia sem parar).
  try {
    const update = (await req.json()) as Update;
    const msg = update.message;
    if (!msg?.text) return NextResponse.json({ ok: true });
    const chatId = String(msg.chat.id);
    const chatName = msg.chat.title || msg.chat.first_name || msg.chat.username || null;
    const [cmd, arg] = msg.text.trim().split(/\s+/, 2);

    if (cmd.startsWith("/start")) {
      if (!arg) {
        await sendMessage(
          chatId,
          "Olá! Para vincular, abra o WalletQuantso em <b>Configurações › Telegram</b> e toque em <b>Vincular meu Telegram</b>.",
        );
      } else {
        const owner = await linkByCode(arg, chatId, chatName);
        if (owner) {
          await sendMessage(chatId, "✅ Vinculado! Você vai receber as contas a pagar por conta todo dia de manhã. Mande /contas para receber agora.");
          try {
            await sendPayablesReport(owner);
          } catch {
            /* o dono vê o erro na tela de Configurações */
          }
        } else {
          await sendMessage(chatId, "Código inválido ou já usado. Gere um novo em Configurações › Telegram.");
        }
      }
      return NextResponse.json({ ok: true });
    }

    if (cmd.startsWith("/contas")) {
      const s = await ownerByChat(chatId);
      if (!s) {
        await sendMessage(chatId, "Este chat ainda não está vinculado. Use Configurações › Telegram no app.");
      } else {
        await sendPayablesReport(s.ownerId);
      }
      return NextResponse.json({ ok: true });
    }

    await sendMessage(chatId, "Comandos: /contas — contas a pagar por conta, agora.");
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("telegram webhook:", (err as Error).message);
    return NextResponse.json({ ok: true });
  }
}
