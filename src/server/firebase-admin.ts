// WalletQuantso — server-side Firebase Admin (token verification only).
//
// Used by API routes to confirm the caller is the signed-in owner before doing
// anything sensitive (e.g. reading the Cora bank statement). Verifying an ID
// token only needs the project id — no service account — so the setup stays
// light. A service account can be added later (FIREBASE_SERVICE_ACCOUNT) to
// enable server-side Firestore writes / scheduled syncs.

import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

function ensureApp() {
  if (getApps().length) return;
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (serviceAccount) {
    initializeApp({ credential: cert(JSON.parse(serviceAccount)) });
    return;
  }
  const projectId =
    process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new Error(
      "Configuração ausente: defina FIREBASE_PROJECT_ID (ou NEXT_PUBLIC_FIREBASE_PROJECT_ID) para validar o login.",
    );
  }
  initializeApp({ projectId });
}

/**
 * Firestore via the Admin SDK — needed for server-side writes (scheduled sync).
 * Requires FIREBASE_SERVICE_ACCOUNT to be set; throws with a clear message if not.
 */
export function getAdminDb(): Firestore {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    throw new Error(
      "Sincronização automática requer FIREBASE_SERVICE_ACCOUNT (service account do Firebase) configurado no servidor.",
    );
  }
  ensureApp();
  return getFirestore();
}

/** Verify a Firebase ID token and return its decoded claims (throws if invalid). */
export async function verifyIdToken(idToken: string): Promise<DecodedIdToken> {
  ensureApp();
  return getAuth().verifyIdToken(idToken);
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
