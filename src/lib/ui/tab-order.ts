// WalletQuantso — para onde o Tab / Shift+Tab leva o foco (lógica pura).
//
// A lista é a dos controles que podem receber foco, na ordem da tela. O foco
// atual pode estar nela (`at` = posição) ou fora dela (ex.: num campo só de
// leitura, ou em nenhum campo); nesse caso `insertAt` diz quantos itens da
// lista vêm antes dele. Nas pontas, dá a volta.

/** Índice do destino na lista, ou -1 se a lista está vazia. */
export function tabTarget(length: number, at: number, insertAt: number, backwards: boolean): number {
  if (length <= 0) return -1;
  if (at >= 0) return (at + (backwards ? -1 : 1) + length) % length;
  if (backwards) return insertAt - 1 >= 0 ? insertAt - 1 : length - 1;
  return insertAt < length ? insertAt : 0;
}
