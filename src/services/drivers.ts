// WalletQuantso — Motoristas / Corridas (Firestore).
//
// Motoristas, lançamentos de corridas por empresa, configuração de pagamento
// e os acessos restritos (e-mails que só enxergam essa tela). Todos os
// documentos pertencem ao DONO do negócio (ownerId); um acesso restrito
// escreve em nome do dono, e as regras do Firestore conferem isso pelo
// documento members/{e-mail}.

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  type DocumentData,
} from "firebase/firestore";
import { db } from "./firebase";
import { COLLECTIONS } from "./firestore";
import { liveList } from "./live-store";
import type { Driver, DriverSettings, Member, RideEntry } from "@/types";

// ── Motoristas ────────────────────────────────────────────────────────────

export async function listDrivers(ownerId: string): Promise<Driver[]> {
  const all = await liveList<Driver>(COLLECTIONS.drivers, ownerId);
  return all.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export async function createDriver(d: Omit<Driver, "id">): Promise<string> {
  const ref = await addDoc(collection(db, COLLECTIONS.drivers), d);
  return ref.id;
}

export function updateDriver(id: string, patch: Partial<Driver>): Promise<void> {
  return updateDoc(doc(db, COLLECTIONS.drivers, id), patch as DocumentData);
}

export function removeDriver(id: string): Promise<void> {
  return deleteDoc(doc(db, COLLECTIONS.drivers, id));
}

// ── Corridas ──────────────────────────────────────────────────────────────

export async function listRides(ownerId: string): Promise<RideEntry[]> {
  const all = await liveList<RideEntry>(COLLECTIONS.rides, ownerId);
  return all.sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));
}

export async function createRide(r: Omit<RideEntry, "id">): Promise<string> {
  const ref = await addDoc(collection(db, COLLECTIONS.rides), r);
  return ref.id;
}

export function updateRide(id: string, patch: Partial<RideEntry>): Promise<void> {
  return updateDoc(doc(db, COLLECTIONS.rides, id), patch as DocumentData);
}

export function removeRide(id: string): Promise<void> {
  return deleteDoc(doc(db, COLLECTIONS.rides, id));
}

// ── Configuração (um doc por dono) ────────────────────────────────────────

export async function getDriverSettings(ownerId: string): Promise<DriverSettings | null> {
  // Não deixa a tela presa se o servidor demorar: depois de 6 s segue sem a
  // configuração (a tela recarrega quando as listas sincronizarem).
  const read = getDoc(doc(db, COLLECTIONS.driverSettings, ownerId)).then((snap) =>
    snap.exists() ? (snap.data() as DriverSettings) : null,
  );
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000));
  return Promise.race([read, timeout]);
}

export function saveDriverSettings(settings: DriverSettings): Promise<void> {
  return setDoc(doc(db, COLLECTIONS.driverSettings, settings.ownerId), settings, { merge: true });
}

// ── Acessos restritos ─────────────────────────────────────────────────────

export const normalizeEmail = (e: string) => e.trim().toLowerCase();

export async function listMembers(ownerId: string): Promise<Member[]> {
  const all = await liveList<Member>(COLLECTIONS.members, ownerId);
  return all.sort((a, b) => a.email.localeCompare(b.email));
}

export function addMember(m: Omit<Member, "id">): Promise<void> {
  const email = normalizeEmail(m.email);
  return setDoc(doc(db, COLLECTIONS.members, email), { ...m, email });
}

export function removeMember(email: string): Promise<void> {
  return deleteDoc(doc(db, COLLECTIONS.members, normalizeEmail(email)));
}

/** Acesso restrito do e-mail logado (null = não é acesso restrito). */
export async function getMembership(email: string): Promise<Member | null> {
  const id = normalizeEmail(email);
  if (!id) return null;
  try {
    const snap = await getDoc(doc(db, COLLECTIONS.members, id));
    return snap.exists() ? ({ id: snap.id, ...(snap.data() as object) } as Member) : null;
  } catch {
    // Sem permissão/offline: trata como conta normal (dona dos próprios dados).
    return null;
  }
}
