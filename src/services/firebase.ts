// Firebase app initialization and shared SDK singletons.
//
// Configuration comes exclusively from environment variables — no keys are
// hard-coded in the source. Provide them via `.env.local` for local dev and
// via the hosting provider's environment settings in production. See
// `.env.example` for the required variable names.
//
// O Firestore roda com cache persistente (IndexedDB) + listeners: o histórico
// fica guardado no aparelho e, ao reconectar, o servidor manda APENAS os
// documentos que mudaram desde a última vez. É o que derruba o consumo da
// cota gratuita de leituras — rebaixar o histórico inteiro a cada abertura
// custava milhares de leituras; os deltas custam dezenas.

import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

// Reuse the existing app during hot-module reloads instead of re-initializing.
export const app: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth: Auth = getAuth(app);

function makeDb(): Firestore {
  // No servidor (build/SSR) não há IndexedDB; e num hot-reload o Firestore já
  // pode estar inicializado — nos dois casos, cai no getFirestore simples.
  if (typeof window === "undefined") return getFirestore(app);
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    return getFirestore(app);
  }
}

export const db: Firestore = makeDb();
