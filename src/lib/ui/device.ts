// Aparelho em uso, para o que muda entre computador e iPhone/iPad.

/** iPhone ou iPad (o iPad se apresenta como Mac, mas tem tela de toque). */
export function isAppleTouch(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** Campo de digitar (as caixas de escolha e de data do app têm um por dentro). */
export const TEXT_ENTRY_TYPES = /^(text|search|tel|url|email|password|number)$/;

export function isTextEntry(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return TEXT_ENTRY_TYPES.test(el.type);
  return el instanceof HTMLElement && el.isContentEditable;
}
