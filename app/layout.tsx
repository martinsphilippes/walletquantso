import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/services/auth-context";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "WalletQuantso",
  description: "Sistema de controle financeiro pessoal.",
  manifest: "/manifest.webmanifest",
  // Ícone da tela de início (iPhone/iPad/Android): a logomarca Quantso.
  icons: {
    icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "Wallet",
    statusBarStyle: "black-translucent",
  },
};

// No app da tela de início do iPhone/iPad a página vai até o topo real da
// tela (por baixo da barra de status); as barras do app cobrem essa área.
export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: "#0a0b0d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
