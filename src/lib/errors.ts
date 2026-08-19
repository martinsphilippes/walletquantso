// WalletQuantso — mensagens de erro amigáveis para falhas de carregamento.
//
// O erro cru do Firebase ("Quota exceeded") não diz nada para quem usa o
// app; aqui ele vira uma explicação em português com o que esperar.

export function loadErrorMessage(err: unknown): string {
  const msg = (err as Error)?.message ?? String(err);
  if (/quota exceeded|resource.?exhausted/i.test(msg)) {
    return (
      "o limite diário gratuito de leituras do banco de dados foi atingido. " +
      "Ele zera de madrugada (por volta das 4h) e o app volta ao normal; " +
      "até lá, o que aparece são os últimos dados guardados no aparelho."
    );
  }
  if (/failed to fetch|network|offline|unavailable/i.test(msg)) {
    return "sem conexão com o servidor agora — mostrando os últimos dados guardados no aparelho.";
  }
  return msg;
}
