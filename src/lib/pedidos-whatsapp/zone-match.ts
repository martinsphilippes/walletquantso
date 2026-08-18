// Tokenização tolerante de nomes de bairro, compartilhada pelo parser e pelo
// faturamento: normaliza acentos/caixa, tira pontuação e palavras de ligação
// (da/das/de/do/dos/e) e reduz plural simples ("arvores" → "arvore"). Assim
// "Caminho da arvore »" e "Caminho das Árvores" produzem os mesmos tokens.

export const ZONE_STOPWORDS = new Set(["da", "das", "de", "do", "dos", "e"]);

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function zoneTokens(s: string): string[] {
  return norm(s)
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t && !ZONE_STOPWORDS.has(t))
    .map((t) => t.replace(/s$/, ""));
}
