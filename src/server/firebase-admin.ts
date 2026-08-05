// WalletQuantso — server-side Firebase helpers.
//
// verifyIdToken: validates a Firebase Auth ID token using Node's own crypto
// against Google's published certificates. We deliberately do NOT use
// firebase-admin/auth here: its dependency chain (jwks-rsa → jose) fails to
// load on Vercel's runtime (ERR_REQUIRE_ESM), crashing the route with a 500.
// A Firebase ID token is a standard RS256 JWT, so manual verification is
// small, dependency-free and robust.
//
// getAdminDb: Firestore via firebase-admin (app + firestore only — that chain
// does not involve jwks-rsa), used by the scheduled Cora sync for server-side
// writes. Requires FIREBASE_SERVICE_ACCOUNT.

import crypto from "node:crypto";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

/** Claims of a verified Firebase ID token (uid mirrors `sub`). */
export interface DecodedIdToken {
  uid: string;
  sub: string;
  email?: string;
  [claim: string]: unknown;
}

const CERTS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

let certCache: { certs: Record<string, string>; expires: number } | null = null;

/** Google's current token-signing certificates, cached per max-age. */
async function googleCerts(): Promise<Record<string, string>> {
  if (certCache && Date.now() < certCache.expires) return certCache.certs;
  const res = await fetch(CERTS_URL);
  if (!res.ok) {
    throw new Error("Não foi possível obter as chaves públicas do Google para validar o login.");
  }
  const certs = (await res.json()) as Record<string, string>;
  const maxAge = /max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "");
  const ttl = maxAge ? Number(maxAge[1]) * 1000 : 60 * 60 * 1000;
  certCache = { certs, expires: Date.now() + ttl };
  return certs;
}

function decodePart(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

function projectId(): string {
  const id = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!id) {
    throw new Error(
      "Configuração ausente: defina FIREBASE_PROJECT_ID (ou NEXT_PUBLIC_FIREBASE_PROJECT_ID) para validar o login.",
    );
  }
  return id;
}

/** Verify a Firebase ID token (RS256 JWT) and return its claims. Throws if invalid. */
export async function verifyIdToken(idToken: string): Promise<DecodedIdToken> {
  const pid = projectId();
  const [h, p, s] = idToken.split(".");
  if (!h || !p || !s) throw new Error("Token malformado.");

  const header = decodePart(h) as { alg?: string; kid?: string };
  if (header.alg !== "RS256" || !header.kid) throw new Error("Algoritmo de token inválido.");

  const certs = await googleCerts();
  const certPem = certs[header.kid];
  if (!certPem) throw new Error("Certificado de assinatura desconhecido.");

  const publicKey = new crypto.X509Certificate(certPem).publicKey;
  const valid = crypto.verify(
    "sha256",
    Buffer.from(`${h}.${p}`),
    publicKey,
    Buffer.from(s, "base64url"),
  );
  if (!valid) throw new Error("Assinatura do token inválida.");

  const payload = decodePart(p) as {
    exp?: number;
    iat?: number;
    aud?: string;
    iss?: string;
    sub?: string;
    email?: string;
  };
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= now) throw new Error("Sessão expirada.");
  if (payload.iat && payload.iat > now + 300) throw new Error("Token emitido no futuro.");
  if (payload.aud !== pid) throw new Error("Token de outro projeto.");
  if (payload.iss !== `https://securetoken.google.com/${pid}`) throw new Error("Emissor inválido.");
  if (!payload.sub) throw new Error("Token sem usuário.");

  return { ...payload, uid: payload.sub, sub: payload.sub };
}

/**
 * Optional single-user lock: when CORA_ALLOWED_EMAIL is set, only that account
 * may use the integration. Returns null when allowed, or an error message.
 */
export function emailNotAllowed(decoded: DecodedIdToken): string | null {
  const allowed = process.env.CORA_ALLOWED_EMAIL?.trim().toLowerCase();
  if (!allowed) return null;
  if ((decoded.email ?? "").toLowerCase() !== allowed) {
    return "Esta conta não tem permissão para usar a integração Cora.";
  }
  return null;
}

function ensureApp() {
  if (getApps().length) return;
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccount) {
    throw new Error(
      "Sincronização automática requer FIREBASE_SERVICE_ACCOUNT (service account do Firebase) configurado no servidor.",
    );
  }
  initializeApp({ credential: cert(JSON.parse(serviceAccount)) });
}

/** Firestore via the Admin SDK — needed for server-side writes (scheduled sync). */
export function getAdminDb(): Firestore {
  ensureApp();
  return getFirestore();
}
