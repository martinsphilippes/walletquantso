// WalletQuantso — formatação de dinheiro.
//
// Valores em reais normalmente têm centavos, mas regras de taxa (ex.: L-BTC
// com valor fixo 0,425) geram lançamentos com fração de centavo. Esses
// valores são gravados exatos (até 4 casas) e precisam aparecer exatos,
// senão o que o app mostra não bate com o banco.

/** Tem fração de centavo? (ex.: 0,425 sim; 0,43 não) */
export function hasSubCents(n: number): boolean {
  return Math.abs(Math.round(n * 100) - n * 100) > 1e-6;
}

/** "R$ 1.234,56", ou com até 4 casas quando o valor tem fração de centavo. */
export function brl(n: number): string {
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: hasSubCents(n) ? 4 : 2,
  });
}

/** Arredonda a 4 casas (fração de centavo preservada, ruído de ponto flutuante não). */
export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
