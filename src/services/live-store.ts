// WalletQuantso — assinaturas vivas por coleção (onSnapshot + cache local).
//
// Cada coleção do usuário vira UMA assinatura do Firestore que fica ativa a
// sessão inteira. Com o cache persistente (IndexedDB) ligado no firebase.ts:
//
//   • a primeira emissão vem do cache do aparelho (instantânea, custo zero);
//   • o servidor manda em seguida APENAS os documentos que mudaram desde a
//     última sincronização (é isso que poupa a cota de leituras);
//   • escritas locais aparecem na hora (compensação de latência) — não é
//     preciso invalidar nada depois de criar/editar/excluir.
//
// A API para os serviços continua a mesma dos antigos getDocs: uma Promise
// com a lista atual da coleção.

import {
  collection,
  onSnapshot,
  query,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "./firebase";

interface Store {
  docs: unknown[];
  ready: Promise<void>;
  settled: boolean;
  settle: () => void;
  fail: (err: Error) => void;
}

const stores = new Map<string, Store>();

// Tempo máximo esperando a PRIMEIRA resposta do servidor. Passado isso a tela
// abre com o que houver no cache (pode ser vazio) e o listener continua; quando
// o servidor responder, `onListsChange` avisa e a tela recarrega sozinha.
const FIRST_RESPONSE_TIMEOUT_MS = 6000;

// Coleções que abriram pelo timeout e ainda não receberam o servidor.
const pendingServer = new Set<string>();

/** Alguma lista ainda está esperando a primeira resposta do servidor? */
export function hasPendingSync(): boolean {
  return pendingServer.size > 0;
}

// Avisa as telas quando qualquer coleção muda (lançamento feito em outro
// aparelho, baixa, sincronização): elas recarregam sozinhas, sem F5.
type ChangeListener = () => void;
const changeListeners = new Set<ChangeListener>();
let notifyTimer: ReturnType<typeof setTimeout> | null = null;

function notifyChange(): void {
  if (notifyTimer) return; // agrupa rajadas de mudanças num aviso só
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    for (const fn of [...changeListeners]) fn();
  }, 400);
}

/** Registra um ouvinte de mudanças; devolve a função para cancelar. */
export function onListsChange(fn: ChangeListener): () => void {
  changeListeners.add(fn);
  return () => {
    changeListeners.delete(fn);
  };
}

// O cache antigo em localStorage (wq.cache.*) não é mais usado — limpa uma vez.
if (typeof window !== "undefined") {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("wq.cache.")) doomed.push(k);
    }
    for (const k of doomed) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

function mapDocs(docs: QueryDocumentSnapshot<DocumentData>[]): unknown[] {
  return docs.map((d) => ({ id: d.id, ...(d.data() as object) }));
}

function attach(collectionName: string, ownerId: string, key: string): Store {
  let settle: () => void = () => {};
  let fail: (err: Error) => void = () => {};
  const ready = new Promise<void>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  const store: Store = { docs: [], ready, settled: false, settle, fail };

  const q = query(collection(db, collectionName), where("ownerId", "==", ownerId));
  let sawServer = false;
  const timer = setTimeout(() => {
    if (store.settled) return;
    // Servidor não respondeu a tempo: abre com o cache e segue esperando.
    pendingServer.add(key);
    store.settled = true;
    store.settle();
  }, FIRST_RESPONSE_TIMEOUT_MS);
  onSnapshot(
    q,
    (snap) => {
      const first = !store.settled;
      store.docs = mapDocs(snap.docs);
      if (!snap.metadata.fromCache && !sawServer) {
        sawServer = true;
        const wasPending = pendingServer.delete(key);
        // Chegou o servidor depois de a tela abrir pelo timeout: avisa.
        if (wasPending && !first) notifyChange();
      }
      // Resolve na primeira emissão útil: dados do cache do aparelho (quando
      // existem) aparecem na hora; num primeiro acesso sem cache, espera a
      // resposta do servidor para não mostrar telas vazias por engano.
      if (first && (!snap.metadata.fromCache || snap.docs.length > 0)) {
        clearTimeout(timer);
        store.settled = true;
        store.settle();
      }
      // Emissões seguintes = algo mudou (aqui ou em outro aparelho).
      if (!first) notifyChange();
    },
    (err) => {
      clearTimeout(timer);
      pendingServer.delete(key);
      if (!store.settled) {
        store.settled = true;
        store.fail(err);
      } else {
        // A assinatura caiu depois de a tela já estar aberta: quem recarregar
        // tenta de novo e recebe o erro de forma visível.
        notifyChange();
      }
      // Remove a assinatura quebrada: a próxima leitura tenta de novo
      // (ex.: cota liberada, rede de volta, novo login).
      stores.delete(key);
    },
  );

  return store;
}

/**
 * Lista atual da coleção do usuário. A primeira chamada liga a assinatura;
 * as seguintes resolvem na hora com o que o listener mantém em memória.
 * Sempre devolve uma cópia rasa (ordenações dos consumidores não vazam).
 */
export function liveList<T>(collectionName: string, ownerId: string): Promise<T[]> {
  const key = `${collectionName}|${ownerId}`;
  let store = stores.get(key);
  if (!store) {
    store = attach(collectionName, ownerId, key);
    stores.set(key, store);
  }
  const st = store;
  return st.ready.then(() => [...(st.docs as T[])]);
}
