import type { Metadata } from "next";

// O /rapido é um "app" próprio na tela de início: o manifesto dele abre
// direto no lançamento rápido (o manifesto raiz abre no Dashboard).
export const metadata: Metadata = {
  manifest: "/manifest-rapido.webmanifest",
};

export default function RapidoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
