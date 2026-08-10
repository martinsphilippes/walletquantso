// WalletQuantso — clients of the delivery business (Firestore CRUD).
//
// Each client carries its own billing rules (diária, tabela de bairros,
// percentual do faturamento); the pure charge math lives in lib/clients.

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "./firebase";
import { COLLECTIONS } from "./firestore";
import type { Client, ClientBillingRecord } from "@/types";

function mapDocs<T>(snap: { docs: QueryDocumentSnapshot<DocumentData>[] }): T[] {
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as T);
}

/** List the clients owned by a user, sorted by name. */
export async function listClients(ownerId: string): Promise<Client[]> {
  const q = query(collection(db, COLLECTIONS.clients), where("ownerId", "==", ownerId));
  return mapDocs<Client>(await getDocs(q)).sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR"),
  );
}

/** Create a client. Returns its id. */
export async function createClient(client: Omit<Client, "id">): Promise<string> {
  const ref = await addDoc(collection(db, COLLECTIONS.clients), client);
  return ref.id;
}

/** Update mutable fields of a client. */
export function updateClient(id: string, patch: Partial<Client>): Promise<void> {
  return updateDoc(doc(db, COLLECTIONS.clients, id), patch as DocumentData);
}

/** Delete a client (does not touch títulos already generated). */
export function removeClient(id: string): Promise<void> {
  return deleteDoc(doc(db, COLLECTIONS.clients, id));
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
  const q = query(
    collection(db, COLLECTIONS.clientBillings),
    where("ownerId", "==", ownerId),
  );
  return mapDocs<ClientBillingRecord>(await getDocs(q))
    .filter((r) => !clientId || r.clientId === clientId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Delete a billing record (does not touch the título gerado). */
export function removeClientBilling(id: string): Promise<void> {
  return deleteDoc(doc(db, COLLECTIONS.clientBillings, id));
}
