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
  onSnapshot(
    q,
    (snap) => {
      store.docs = mapDocs(snap.docs);
      // Resolve na primeira emissão útil: dados do cache do aparelho (quando
      // existem) aparecem na hora; num primeiro acesso sem cache, espera a
      // resposta do servidor para não mostrar telas vazias por engano.
      if (!store.settled && (!snap.metadata.fromCache || snap.docs.length > 0)) {
        store.settled = true;
        store.settle();
      }
    },
    (err) => {
      if (!store.settled) {
        store.settled = true;
        store.fail(err);
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
