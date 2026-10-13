"use client";

// WalletQuantso — application shell: collapsible sidebar (desktop),
// slide-in drawer (mobile) and a top header. Brand identity from the
// Quantso logo (monochrome, dark).

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/services/auth-context";
import { signOut } from "@/services/auth";

interface NavEntry {
  label: string;
  href: string;
  icon: string;
}

interface NavGroup {
  /** Chave estável (guardada no aparelho para lembrar aberto/fechado). */
  key: string;
  label: string;
  items: NavEntry[];
}

// O menu em tópicos que abrem e fecham. O dia a dia fica em cima; os
// cadastros e as ferramentas, agrupados embaixo. Ao trocar de tela o tópico
// dela abre sozinho; fora isso, cada tópico lembra a última escolha do
// usuário (qualquer um pode ser fechado, inclusive o da tela atual).
const NAV_GROUPS: NavGroup[] = [
  {
    key: "dia",
    label: "Dia a dia",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: "▦" },
      { label: "Lançamentos", href: "/lancamentos", icon: "≡" },
      { label: "Contas a pagar", href: "/contas-a-pagar", icon: "↑" },
      { label: "Contas a receber", href: "/contas-a-receber", icon: "↓" },
      { label: "Fluxo de caixa", href: "/fluxo-de-caixa", icon: "∿" },
    ],
  },
  {
    key: "operacao",
    label: "Operação",
    items: [
      { label: "Clientes", href: "/clientes", icon: "✦" },
      { label: "Pedidos WhatsApp", href: "/pedidos-whatsapp", icon: "✉" },
      { label: "Motoristas/Corridas", href: "/motoristas", icon: "⛟" },
    ],
  },
  {
    key: "banco",
    label: "Banco e conciliação",
    items: [
      { label: "Contas financeiras", href: "/accounts", icon: "▤" },
      { label: "Cartões de crédito", href: "/cartoes", icon: "▭" },
      { label: "Conciliação", href: "/conciliacao", icon: "⇄" },
      { label: "Sincronizar Cora", href: "/cora", icon: "⟳" },
      { label: "Importação de dados", href: "/import", icon: "⤓" },
    ],
  },
  {
    key: "cadastros",
    label: "Cadastros",
    items: [
      { label: "Centros de custo", href: "/centros-de-custo", icon: "◈" },
      { label: "Categorias", href: "/categories", icon: "◪" },
      { label: "Subcategorias", href: "/subcategorias", icon: "◫" },
      { label: "Pessoas e contatos", href: "/contatos", icon: "☺" },
    ],
  },
  {
    key: "analise",
    label: "Análise e sistema",
    items: [
      { label: "Relatórios", href: "/reports", icon: "▧" },
      { label: "Auditoria", href: "/auditoria", icon: "◷" },
      { label: "Configurações", href: "/configuracoes", icon: "⚙" },
    ],
  },
];
const NAV: NavEntry[] = NAV_GROUPS.flatMap((g) => g.items);

/** A rota atual é esta tela? (/dashboard só exato; as outras incluem subrotas.) */
function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
}

const OPEN_KEY = "wq.nav.open";
/** Seções abertas lembradas no aparelho (padrão: só "Dia a dia"). */
function loadOpen(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(OPEN_KEY);
    if (raw) return JSON.parse(raw) as Record<string, boolean>;
  } catch {
    /* ignore */
  }
  return { dia: true };
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, restricted } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({ dia: true });
  useEffect(() => {
    setOpen(loadOpen());
  }, []);
  const persistOpen = (next: Record<string, boolean>) => {
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    return next;
  };
  const toggleGroup = (key: string) => setOpen((prev) => persistOpen({ ...prev, [key]: !prev[key] }));

  // Ao TROCAR de tela, o tópico da tela nova abre sozinho (para o item atual
  // ficar à vista). Depois disso qualquer tópico pode ser fechado, inclusive o
  // da tela atual — e fechado ele fica, mesmo ao recarregar; o título dele
  // ganha destaque para mostrar onde você está.
  const prevPath = useRef(pathname);
  useEffect(() => {
    if (prevPath.current === pathname) return;
    prevPath.current = pathname;
    const g = NAV_GROUPS.find((grp) => grp.items.some((i) => isActivePath(pathname, i.href)));
    if (g) setOpen((prev) => (prev[g.key] ? prev : persistOpen({ ...prev, [g.key]: true })));
  }, [pathname]);

  // Acesso restrito só enxerga Motoristas/Corridas: qualquer outra rota volta
  // para lá (as regras do Firestore já bloqueiam os dados; isto é a cortesia).
  const restrictedHome = "/motoristas";
  useEffect(() => {
    if (restricted && !pathname.startsWith(restrictedHome)) router.replace(restrictedHome);
  }, [restricted, pathname, router]);

  // /rapido é a tela enxuta de celular: sem menu lateral nem topbar.
  if (pathname.startsWith("/rapido")) {
    return <>{children}</>;
  }

  // Antes do login ninguém vê os módulos; depois, só o que a conta pode usar.
  const signedIn = !loading && !!user;
  const isActive = (href: string) => isActivePath(pathname, href);
  // Acesso restrito: só a tela dele, sem tópicos. Dono: tópicos que abrem e
  // fecham, inclusive o da tela atual.
  const groups: NavGroup[] = !signedIn
    ? []
    : restricted
      ? [{ key: "dia", label: "", items: NAV.filter((n) => n.href === restrictedHome) }]
      : NAV_GROUPS;
  const renderItem = (item: NavEntry) => (
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
  );

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
          {!signedIn && (
            <span className="label muted" style={{ padding: "0.5rem 1rem", fontSize: "0.8rem" }}>
              {loading ? "Carregando…" : "Entre para ver os módulos."}
            </span>
          )}
          {groups.map((g) => {
            const hasActive = g.items.some((i) => isActive(i.href));
            // Sem rótulo (acesso restrito) ou com a barra recolhida: só os itens.
            if (!g.label || collapsed) return <div key={g.key}>{g.items.map(renderItem)}</div>;
            const isOpen = !!open[g.key];
            return (
              <div key={g.key} className="nav-group">
                <button
                  type="button"
                  className={`nav-group-head${hasActive ? " has-active" : ""}`}
                  onClick={() => toggleGroup(g.key)}
                  aria-expanded={isOpen}
                  title={hasActive && !isOpen ? "A tela atual está neste tópico" : undefined}
                >
                  <span className="label">{g.label}</span>
                  <span className="chev" aria-hidden>{isOpen ? "▾" : "▸"}</span>
                </button>
                {isOpen && <div className="nav-group-items">{g.items.map(renderItem)}</div>}
              </div>
            );
          })}
        </nav>
        <div
          className="label muted"
          style={{ padding: "0.5rem 1rem", fontSize: "0.7rem", marginTop: "auto" }}
          title="Versão do app em execução (build publicado)"
        >
          Versão {process.env.NEXT_PUBLIC_BUILD_SHA} · {process.env.NEXT_PUBLIC_BUILD_TIME}
        </div>
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
