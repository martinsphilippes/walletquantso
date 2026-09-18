// WalletQuantso — webhook do robô do Telegram.
//
// POST /api/telegram/webhook — o Telegram chama aqui a cada mensagem enviada
// ao robô. Validado pelo cabeçalho X-Telegram-Bot-Api-Secret-Token (o mesmo
// TELEGRAM_WEBHOOK_SECRET passado no setWebhook).
//
// Comandos:
//   /start <código>  — vincula este chat ao dono que gerou o código no app.
//   /contas          — manda agora as contas a pagar por conta.
//   /gastos          — manda agora os gastos do mês por categoria.
//   /centros         — manda agora o resultado do mês por centro de custo.
//   /tudo            — manda os três de uma vez.
//   /centro <nome>   — detalha um centro de custo por categoria (ex.: /centro Ituiutaba).
//   /ajuda           — lista de comandos (qualquer outro texto também).

import { NextResponse } from "next/server";
import { helpText, linkByCode, ownerByChat, sendCostCenterDetail, sendMessage, sendReports } from "@/server/telegram";

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
    const text = msg.text.trim();
    const cmd = text.split(/\s+/, 1)[0];
    const arg = text.slice(cmd.length).trim();

    if (cmd.startsWith("/start")) {
      if (!arg) {
        await sendMessage(
          chatId,
          "Olá! Para vincular, abra o WalletQuantso em <b>Configurações › Telegram</b> e toque em <b>Vincular meu Telegram</b>.",
        );
      } else {
        const owner = await linkByCode(arg, chatId, chatName);
        if (owner) {
          await sendMessage(
            chatId,
            "✅ Vinculado! Todo dia de manhã você recebe as contas a pagar por conta, os gastos do mês por categoria e o resultado por centro de custo. Comandos: /contas, /gastos, /centros ou /tudo (os três).",
          );
          try {
            await sendReports(owner, "all");
          } catch {
            /* o dono vê o erro na tela de Configurações */
          }
        } else {
          await sendMessage(chatId, "Código inválido ou já usado. Gere um novo em Configurações › Telegram.");
        }
      }
      return NextResponse.json({ ok: true });
    }

    // /centro <nome> antes de /centros (prefixo em comum).
    if (/^\/centro(@\w+)?$/i.test(cmd)) {
      const s = await ownerByChat(chatId);
      if (!s) {
        await sendMessage(chatId, "Este chat ainda não está vinculado. Use Configurações › Telegram no app.");
      } else {
        await sendCostCenterDetail(s.ownerId, arg);
      }
      return NextResponse.json({ ok: true });
    }

    const kinds: Record<string, "payables" | "expenses" | "costcenters" | "all"> = {
      "/contas": "payables",
      "/gastos": "expenses",
      "/centros": "costcenters",
      "/tudo": "all",
    };
    const kind = Object.keys(kinds).find((k) => cmd.startsWith(k));
    if (kind) {
      const s = await ownerByChat(chatId);
      if (!s) {
        await sendMessage(chatId, "Este chat ainda não está vinculado. Use Configurações › Telegram no app.");
      } else {
        await sendReports(s.ownerId, kinds[kind]);
      }
      return NextResponse.json({ ok: true });
    }

    await sendMessage(chatId, helpText());
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("telegram webhook:", (err as Error).message);
    return NextResponse.json({ ok: true });
  }
}
