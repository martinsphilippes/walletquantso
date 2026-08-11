// WalletQuantso — cache de listas em memória (por sessão).
//
// Toda leitura de lista dos serviços passa por aqui: a primeira busca vai ao
// servidor e o resultado fica guardado; as visitas seguintes voltam na hora
// do cache (navegação instantânea entre telas) e, se os dados já estiverem
// "velhos", uma atualização roda em segundo plano para a próxima visita.
//
// Correção: TODA escrita nos serviços (criar/editar/excluir/baixar/importar)
// invalida as coleções afetadas, então dentro do app nunca se vê dado
// desatualizado depois de uma ação. O cache vive só em memória — recarregar
// a página busca tudo fresco do servidor.

const FRESH_MS = 30_000;

interface Entry {
  data: unknown[];
  at: number;
}

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown[]>>();

function fetchInto<T>(key: string, fetcher: () => Promise<T[]>): Promise<T[]> {
  const p = fetcher()
    .then((data) => {
      cache.set(key, { data, at: Date.now() });
      return data;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p as Promise<unknown[]>);
  return p;
}

/**
 * Devolve a lista do cache quando existe (e atualiza em segundo plano se
 * estiver velha); senão busca no servidor e guarda. Sempre devolve uma cópia
 * rasa, para ordenações/mutações dos consumidores não vazarem entre telas.
 */
export function cachedList<T>(key: string, fetcher: () => Promise<T[]>): Promise<T[]> {
  const hit = cache.get(key);
  if (hit) {
    if (Date.now() - hit.at > FRESH_MS && !inflight.has(key)) {
      fetchInto(key, fetcher).catch(() => {
        // Atualização de fundo falhou (offline, etc.): o cache atual continua.
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
  for (const key of [...cache.keys()]) {
    if (collections.some((c) => key === c || key.startsWith(`${c}|`))) cache.delete(key);
  }
  for (const key of [...inflight.keys()]) {
    if (collections.some((c) => key === c || key.startsWith(`${c}|`))) inflight.delete(key);
  }
}

/** Invalida tudo (importações em lote, sincronização Cora, merges profundos). */
export function invalidateAllLists(): void {
  cache.clear();
  inflight.clear();
}
