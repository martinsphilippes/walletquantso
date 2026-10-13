// WalletQuantso — versão publicada no servidor.
//
// GET /api/version → { sha, time } do build que está no ar. O botão de
// atualizar (topo da tela) compara com a versão carregada no aparelho e
// acende quando há build novo, sem o usuário precisar fechar e abrir o app.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { sha: process.env.NEXT_PUBLIC_BUILD_SHA ?? "dev", time: process.env.NEXT_PUBLIC_BUILD_TIME ?? "" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
