// WalletQuantso — Cora API client (server-only, mutual TLS).
//
// The Cora API requires mTLS (a client certificate + private key), so this can
// only run on the server. Credentials come from environment variables set on
// the host (Vercel), never from the browser or the repository.
//
// Env vars:
//   CORA_CLIENT_ID        — the application's client id from Cora
//   CORA_CERT_BASE64      — base64 of the certificate .pem
//   CORA_KEY_BASE64       — base64 of the private key .key
//   CORA_BASE_URL         — default https://matls-clients.api.cora.com.br
//   CORA_SCOPE            — optional scope requested on the token (e.g. "account")

import https from "node:https";
import {
  normalizeCoraStatement,
  type CoraStatementResponse,
  type NormalizedEntry,
} from "@/lib/cora/statement";

const DEFAULT_BASE_URL = "https://matls-clients.api.cora.com.br";

export class CoraConfigError extends Error {}

interface CoraConfig {
  clientId: string;
  cert: string;
  key: string;
  baseUrl: string;
  scope?: string;
}

function readConfig(): CoraConfig {
  const clientId = process.env.CORA_CLIENT_ID;
  const certB64 = process.env.CORA_CERT_BASE64;
  const keyB64 = process.env.CORA_KEY_BASE64;
  const missing = [
    !clientId && "CORA_CLIENT_ID",
    !certB64 && "CORA_CERT_BASE64",
    !keyB64 && "CORA_KEY_BASE64",
  ].filter(Boolean);
  if (missing.length) {
    throw new CoraConfigError(
      `Integração Cora não configurada. Faltam variáveis de ambiente: ${missing.join(", ")}.`,
    );
  }
  return {
    clientId: clientId!,
    cert: Buffer.from(certB64!, "base64").toString("utf8"),
    key: Buffer.from(keyB64!, "base64").toString("utf8"),
    baseUrl: (process.env.CORA_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, ""),
    scope: process.env.CORA_SCOPE || undefined,
  };
}

interface HttpResult {
  status: number;
  body: string;
}

/** Minimal HTTPS request with a client certificate (mTLS). */
function request(
  urlStr: string,
  cfg: CoraConfig,
  opts: { method: string; headers?: Record<string, string>; body?: string },
): Promise<HttpResult> {
  const url = new URL(urlStr);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: url.host,
        path: url.pathname + url.search,
        method: opts.method,
        headers: opts.headers,
        cert: cfg.cert,
        key: cfg.key,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/** Obtain an access token via client_credentials + mTLS. */
async function getToken(cfg: CoraConfig): Promise<string> {
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: cfg.clientId,
  });
  if (cfg.scope) params.set("scope", cfg.scope);

  const res = await request(`${cfg.baseUrl}/token`, cfg, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Falha ao autenticar no Cora (HTTP ${res.status}). ${res.body.slice(0, 300)}`);
  }
  const json = JSON.parse(res.body) as { access_token?: string };
  if (!json.access_token) throw new Error("Cora não retornou um access_token.");
  return json.access_token;
}

/**
 * Fetch the account statement for a date range and return normalized movements.
 * Paginates until all entries are collected.
 */
export async function fetchCoraStatement(range: {
  start: string;
  end: string;
}): Promise<NormalizedEntry[]> {
  const cfg = readConfig();
  const token = await getToken(cfg);

  const perPage = 100;
  let page = 1;
  const all: NormalizedEntry[] = [];
  // Guard against runaway pagination.
  for (let guard = 0; guard < 500; guard++) {
    const qs = new URLSearchParams({
      start: range.start,
      end: range.end,
      page: String(page),
      perPage: String(perPage),
    });
    const res = await request(`${cfg.baseUrl}/bank-statement/statement?${qs}`, cfg, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Falha ao consultar o extrato Cora (HTTP ${res.status}). ${res.body.slice(0, 300)}`);
    }
    const parsed = JSON.parse(res.body) as CoraStatementResponse;
    const entries = parsed.entries ?? [];
    all.push(...normalizeCoraStatement({ entries }));
    if (entries.length < perPage) break;
    page += 1;
  }
  return all;
}
