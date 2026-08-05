// WalletQuantso — scheduled Cora sync endpoint (Vercel Cron).
//
// GET /api/cora/cron
// Protected by CRON_SECRET: Vercel Cron sends "Authorization: Bearer <secret>"
// when the CRON_SECRET env var is set. Manual calls must send the same header.

import { NextResponse } from "next/server";
import { runCoraSync } from "@/server/cora-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // must be configured to run
  const auth = req.headers.get("authorization") || "";
  return auth === `Bearer ${secret}`;
}

async function handle(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  try {
    const outcome = await runCoraSync();
    return NextResponse.json({ ok: true, ...outcome });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

export const GET = handle;
export const POST = handle;
