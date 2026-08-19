// WalletQuantso — clients of the delivery business (Firestore CRUD).
//
// Each client carries its own billing rules (diária, tabela de bairros,
// percentual do faturamento); the pure charge math lives in lib/clients.

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  updateDoc,
  type DocumentData,
} from "firebase/firestore";
import { db } from "./firebase";
import { COLLECTIONS } from "./firestore";
import { liveList } from "./live-store";
import type { Client, ClientBillingRecord } from "@/types";

/** List the clients owned by a user, sorted by name. */
export async function listClients(ownerId: string): Promise<Client[]> {
  const all = await liveList<Client>(COLLECTIONS.clients, ownerId);
  return all.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/** Create a client. Returns its id. */
export async function createClient(client: Omit<Client, "id">): Promise<string> {
  const ref = await addDoc(collection(db, COLLECTIONS.clients), client);
  return ref.id;
}

/** Update mutable fields of a client. */
export async function updateClient(id: string, patch: Partial<Client>): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.clients, id), patch as DocumentData);
}

/** Delete a client (does not touch títulos already generated). */
export async function removeClient(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.clients, id));
}

// ── Histórico de cobranças geradas por cliente ────────────────────────────

/** Record a generated charge (snapshot of diárias/entregas/total). */
export async function addClientBilling(
  record: Omit<ClientBillingRecord, "id">,
): Promise<string> {
  const ref = await addDoc(collection(db, COLLECTIONS.clientBillings), record);
  return ref.id;
}

/** List a user's billing records, newest first (optionally one client's). */
export async function listClientBillings(
  ownerId: string,
  clientId?: string,
): Promise<ClientBillingRecord[]> {
  const all = await liveList<ClientBillingRecord>(COLLECTIONS.clientBillings, ownerId);
  return all
    .filter((r) => !clientId || r.clientId === clientId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Delete a billing record (does not touch the título gerado). */
export async function removeClientBilling(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.clientBillings, id));
}
