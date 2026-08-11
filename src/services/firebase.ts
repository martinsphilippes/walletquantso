// Firebase app initialization and shared SDK singletons.
//
// Configuration comes exclusively from environment variables — no keys are
// hard-coded in the source. Provide them via `.env.local` for local dev and
// via the hosting provider's environment settings in production. See
// `.env.example` for the required variable names.
//
// Usamos o Firestore *lite*: o app só faz leituras pontuais (getDocs) e
// escritas — nada de listeners em tempo real — e o lite corta ~60% do peso
// do SDK e fala com o servidor por HTTP simples (mais rápido no Safari que o
// canal de streaming do SDK completo).

import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore/lite";

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
export const db: Firestore = getFirestore(app);
