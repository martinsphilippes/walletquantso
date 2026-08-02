"use client";

// WalletQuantso — application shell: collapsible sidebar (desktop),
// slide-in drawer (mobile) and a top header. Brand identity from the
// Quantso logo (monochrome, dark).

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/services/auth-context";
import { signOut } from "@/services/auth";

interface NavEntry {
  label: string;
  href: string;
  icon: string;
}

const NAV: NavEntry[] = [
  { label: "Dashboard", href: "/dashboard", icon: "▦" },
  { label: "Lançamentos", href: "/lancamentos", icon: "≡" },
  { label: "Contas a pagar", href: "/contas-a-pagar", icon: "↑" },
  { label: "Contas a receber", href: "/contas-a-receber", icon: "↓" },
  { label: "Conciliação", href: "/conciliacao", icon: "⇄" },
  { label: "Fluxo de caixa", href: "/fluxo-de-caixa", icon: "∿" },
  { label: "Contas financeiras", href: "/accounts", icon: "▤" },
  { label: "Cartões de crédito", href: "/cartoes", icon: "▭" },
  { label: "Categorias", href: "/categories", icon: "◪" },
  { label: "Centros de custo", href: "/centros-de-custo", icon: "◈" },
  { label: "Pessoas e contatos", href: "/contatos", icon: "☺" },
  { label: "Relatórios", href: "/reports", icon: "▧" },
  { label: "Importação de dados", href: "/import", icon: "⤓" },
  { label: "Auditoria", href: "/auditoria", icon: "◷" },
  { label: "Configurações", href: "/configuracoes", icon: "⚙" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (href: string) =>
    pathname === href || (href !== "/dashboard" && pathname.startsWith(href));

  return (
    <div className="shell">
      <div
        className={`scrim${mobileOpen ? " show" : ""}`}
        onClick={() => setMobileOpen(false)}
      />

      <aside
        className={`sidebar${collapsed ? " collapsed" : ""}${mobileOpen ? " mobile-open" : ""}`}
      >
        <div className="sidebar-brand">
          {/* Official Quantso logo — used as-is, not modified. */}
          <img src="/quantso-logo.jpg" alt="Quantso" />
          <span className="word">WalletQuantso</span>
        </div>
        <nav className="nav">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item${isActive(item.href) ? " active" : ""}`}
              onClick={() => setMobileOpen(false)}
              title={item.label}
            >
              <span className="ic" aria-hidden>{item.icon}</span>
              <span className="label">{item.label}</span>
            </Link>
          ))}
        </nav>
      </aside>

      <div className="main-col">
        <header className="topbar">
          <button
            className="icon-btn"
            aria-label="Menu"
            onClick={() => {
              if (window.innerWidth <= 860) setMobileOpen((v) => !v);
              else setCollapsed((v) => !v);
            }}
          >
            ☰
          </button>
          <div className="spacer" />
          {user && (
            <>
              <span className="muted" style={{ fontSize: "0.85rem" }}>{user.email}</span>
              <button className="btn-ghost" onClick={() => signOut()}>
                Sair
              </button>
            </>
          )}
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
