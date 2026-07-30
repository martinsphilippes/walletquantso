import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/services/auth-context";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "WalletQuantso",
  description: "Sistema de controle financeiro pessoal.",
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
