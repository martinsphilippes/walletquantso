// WalletQuantso — Cora statement endpoint.
//
// POST /api/cora/statement  { start: "YYYY-MM-DD", end: "YYYY-MM-DD" }
// Header: Authorization: Bearer <firebase id token>
//
// Verifies the caller is the signed-in owner, then fetches and normalizes the
// Cora bank statement (mTLS happens server-side). Returns the movements; the
// client dedups and saves them as lançamentos.

import { NextResponse } from "next/server";
import { verifyIdToken, emailNotAllowed } from "@/server/firebase-admin";
import { fetchCoraStatement, CoraConfigError } from "@/server/cora";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request) {
  // 1. Authenticate the caller.
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }
  let decoded;
  try {
    decoded = await verifyIdToken(token);
  } catch {
    return NextResponse.json({ error: "Sessão inválida. Entre novamente." }, { status: 401 });
  }
  const denied = emailNotAllowed(decoded);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  // 2. Validate the date range.
  let body: { start?: string; end?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }
  const { start, end } = body;
  if (!start || !end || !ISO_DATE.test(start) || !ISO_DATE.test(end)) {
    return NextResponse.json(
      { error: "Informe 'start' e 'end' no formato YYYY-MM-DD." },
      { status: 400 },
    );
  }
  if (start > end) {
    return NextResponse.json({ error: "A data inicial deve ser anterior à final." }, { status: 400 });
  }

  // 3. Fetch + normalize the statement (entries + real start/end balances).
  try {
    const result = await fetchCoraStatement({ start, end });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof CoraConfigError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json(
      { error: `Falha ao consultar o Cora: ${(err as Error).message}` },
      { status: 502 },
    );
  }
}
