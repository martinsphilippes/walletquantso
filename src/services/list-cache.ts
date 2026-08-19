// WalletQuantso — cache de listas (memória + localStorage).
//
// Toda leitura de lista dos serviços passa por aqui. Objetivos:
//   1. Navegação instantânea: depois da primeira busca, as telas leem do
//      cache em memória.
//   2. Poupar a cota do Firebase: o resultado também fica gravado no
//      aparelho (localStorage), então REABRIR o app não rebaixa tudo do
//      servidor — mostra o que já tem e só atualiza em segundo plano quando
//      os dados estão velhos (FRESH_MS). Sem isso, cada reabertura do app
//      no iPad/celular custava milhares de leituras e estourava a cota
//      gratuita diária ("Quota exceeded").
//
// Correção: TODA escrita nos serviços (criar/editar/excluir/baixar/importar/
// sincronizar) invalida as coleções afetadas — em memória e no aparelho —
// então depois de uma ação os dados voltam frescos do servidor.

const FRESH_MS = 5 * 60_000; // 5 minutos de frescor antes de atualizar de fundo
const LS_PREFIX = "wq.cache.";

interface Entry {
  data: unknown[];
  at: number;
}

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown[]>>();

function persist(key: string, entry: Entry): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(entry));
  } catch {
    // Sem espaço/modo privado: segue só com o cache em memória.
  }
}

function loadPersisted(key: string): Entry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Entry;
    if (!Array.isArray(parsed.data) || typeof parsed.at !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function removePersisted(matches: (key: string) => boolean): void {
  if (typeof window === "undefined") return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_PREFIX) && matches(k.slice(LS_PREFIX.length))) doomed.push(k);
    }
    for (const k of doomed) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

function fetchInto<T>(key: string, fetcher: () => Promise<T[]>): Promise<T[]> {
  const p = fetcher()
    .then((data) => {
      const entry = { data, at: Date.now() };
      cache.set(key, entry);
      persist(key, entry);
      return data;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p as Promise<unknown[]>);
  return p;
}

/**
 * Devolve a lista do cache quando existe (e atualiza em segundo plano só se
 * estiver velha); senão busca no servidor e guarda. Sempre devolve uma cópia
 * rasa, para ordenações/mutações dos consumidores não vazarem entre telas.
 */
export function cachedList<T>(key: string, fetcher: () => Promise<T[]>): Promise<T[]> {
  let hit = cache.get(key);
  if (!hit) {
    const persisted = loadPersisted(key);
    if (persisted) {
      cache.set(key, persisted);
      hit = persisted;
    }
  }
  if (hit) {
    if (Date.now() - hit.at > FRESH_MS && !inflight.has(key)) {
      fetchInto(key, fetcher).catch(() => {
        // Atualização de fundo falhou (offline, cota, etc.): o cache atual
        // continua servindo — melhor dado de 5 min atrás do que erro.
      });
    }
    return Promise.resolve([...(hit.data as T[])]);
  }
  const running = inflight.get(key);
  if (running) return (running as Promise<T[]>).then((d) => [...d]);
  return fetchInto(key, fetcher).then((d) => [...d]);
}

/** Invalida as coleções dadas (qualquer chave `colecao` ou `colecao|...`). */
export function invalidateLists(...collections: string[]): void {
  const matches = (key: string) =>
    collections.some((c) => key === c || key.startsWith(`${c}|`));
  for (const key of [...cache.keys()]) if (matches(key)) cache.delete(key);
  for (const key of [...inflight.keys()]) if (matches(key)) inflight.delete(key);
  removePersisted(matches);
}

/** Invalida tudo (importações em lote, sincronização Cora, merges profundos). */
export function invalidateAllLists(): void {
  cache.clear();
  inflight.clear();
  removePersisted(() => true);
}
