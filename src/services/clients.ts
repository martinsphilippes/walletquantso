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
} from "firebase/firestore/lite";
import { db } from "./firebase";
import { COLLECTIONS } from "./firestore";
import { cachedList, invalidateLists } from "./list-cache";
import type { Client, ClientBillingRecord } from "@/types";

function mapDocs<T>(snap: { docs: QueryDocumentSnapshot<DocumentData>[] }): T[] {
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as T);
}

/** List the clients owned by a user, sorted by name. */
export function listClients(ownerId: string): Promise<Client[]> {
  return cachedList(`clients|${ownerId}`, async () => {
    const q = query(collection(db, COLLECTIONS.clients), where("ownerId", "==", ownerId));
    return mapDocs<Client>(await getDocs(q)).sort((a, b) =>
      a.name.localeCompare(b.name, "pt-BR"),
    );
  });
}

/** Create a client. Returns its id. */
export async function createClient(client: Omit<Client, "id">): Promise<string> {
  const ref = await addDoc(collection(db, COLLECTIONS.clients), client);
  invalidateLists(COLLECTIONS.clients);
  return ref.id;
}

/** Update mutable fields of a client. */
export async function updateClient(id: string, patch: Partial<Client>): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.clients, id), patch as DocumentData);
  invalidateLists(COLLECTIONS.clients);
}

/** Delete a client (does not touch títulos already generated). */
export async function removeClient(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.clients, id));
  invalidateLists(COLLECTIONS.clients);
}

// ── Histórico de cobranças geradas por cliente ────────────────────────────

/** Record a generated charge (snapshot of diárias/entregas/total). */
export async function addClientBilling(
  record: Omit<ClientBillingRecord, "id">,
): Promise<string> {
  const ref = await addDoc(collection(db, COLLECTIONS.clientBillings), record);
  invalidateLists(COLLECTIONS.clientBillings);
  return ref.id;
}

/** List a user's billing records, newest first (optionally one client's). */
export async function listClientBillings(
  ownerId: string,
  clientId?: string,
): Promise<ClientBillingRecord[]> {
  const all = await cachedList(`clientBillings|${ownerId}`, async () => {
    const q = query(
      collection(db, COLLECTIONS.clientBillings),
      where("ownerId", "==", ownerId),
    );
    return mapDocs<ClientBillingRecord>(await getDocs(q));
  });
  return all
    .filter((r) => !clientId || r.clientId === clientId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Delete a billing record (does not touch the título gerado). */
export async function removeClientBilling(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.clientBillings, id));
  invalidateLists(COLLECTIONS.clientBillings);
}
