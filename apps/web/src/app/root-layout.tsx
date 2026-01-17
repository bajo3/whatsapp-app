import React from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LogOut, Menu, MessageSquareText, Moon, Settings, Sun, Users } from "lucide-react";
import { supabase } from "../lib/supabase";
import { getStoredTheme, toggleTheme } from "../lib/theme";

function NavItem({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        `flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition ${
          isActive
            ? "bg-[var(--wa-header)] text-[var(--wa-text)]"
            : "text-[var(--wa-text)]/90 hover:bg-black/5 dark:hover:bg-white/5"
        }`
      }
    >
      {icon}
      <span>{label}</span>
    </NavLink>
  );
}

export function RootLayout() {
  const navigate = useNavigate();
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const [themeMode, setThemeMode] = React.useState(getStoredTheme());

  const ThemeIcon = themeMode === "dark" ? Sun : Moon;

  return (
    <div className="h-full w-full flex bg-[var(--wa-bg)]">
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-[var(--wa-header)] border-b border-[var(--wa-border)] z-30 flex items-center justify-between px-3">
        <button
          type="button"
          className="h-10 w-10 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 inline-flex items-center justify-center"
          onClick={() => setMobileNavOpen(true)}
          aria-label="Abrir menú"
        >
          <Menu size={20} />
        </button>
        <div className="font-semibold text-sm">Gestor WhatsApp</div>
        <button
          type="button"
          className="h-10 w-10 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 inline-flex items-center justify-center"
          onClick={() => {
            const next = toggleTheme();
            setThemeMode(next);
          }}
          aria-label="Cambiar tema"
        >
          <ThemeIcon size={18} />
        </button>
      </div>

      {/* Sidebar (desktop) */}
      <aside className="hidden md:flex w-72 border-r border-[var(--wa-border)] bg-[var(--wa-panel)] flex-col">
        <div className="px-4 pt-4">
          <div className="flex items-center gap-2 rounded-2xl bg-[var(--wa-header)] border border-[var(--wa-border)] px-3 py-3">
            <div className="h-9 w-9 rounded-xl bg-[var(--wa-accent)]" />
            <div className="min-w-0">
              <div className="font-semibold leading-tight">WhatsApp</div>
              <div className="text-xs text-[var(--wa-subtext)] leading-tight">Ventas</div>
            </div>
          </div>
        </div>
        <div className="px-3 mt-3">
          <nav className="flex flex-col gap-1">
            <NavItem to="/" icon={<MessageSquareText size={18} />} label="Chats" />
            <NavItem to="/contacts" icon={<Users size={18} />} label="Clientes" />
            <NavItem to="/settings" icon={<Settings size={18} />} label="Ajustes" />
          </nav>
        </div>
        <div className="flex-1" />

        <button
          type="button"
          className="mx-3 mb-2 flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm text-[var(--wa-text)]/90 hover:bg-black/5 dark:hover:bg-white/5"
          onClick={() => {
            const next = toggleTheme();
            setThemeMode(next);
          }}
        >
          <span className="inline-flex items-center gap-2">
            <ThemeIcon size={18} />
            Tema
          </span>
          <span className="text-xs text-[var(--wa-subtext)]">{themeMode}</span>
        </button>

        <button
          className="mx-3 mb-4 flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-[var(--wa-text)]/90 hover:bg-black/5 dark:hover:bg-white/5"
          onClick={async () => {
            await supabase.auth.signOut();
            navigate("/login");
          }}
        >
          <LogOut size={18} />
          <span>Salir</span>
        </button>
      </aside>

      {/* Sidebar (mobile drawer) */}
      {mobileNavOpen ? (
        <div className="md:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileNavOpen(false)} />
          <aside className="absolute top-0 left-0 h-full w-80 bg-[var(--wa-panel)] border-r border-[var(--wa-border)] p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 rounded-2xl bg-[var(--wa-header)] border border-[var(--wa-border)] px-3 py-3">
              <div className="h-9 w-9 rounded-xl bg-[var(--wa-accent)]" />
              <div className="min-w-0">
                <div className="font-semibold leading-tight">WhatsApp</div>
                <div className="text-xs text-[var(--wa-subtext)] leading-tight">Ventas</div>
              </div>
            </div>
            <nav className="flex flex-col gap-1" onClick={() => setMobileNavOpen(false)}>
              <NavItem to="/" icon={<MessageSquareText size={18} />} label="Chats" />
              <NavItem to="/contacts" icon={<Users size={18} />} label="Clientes" />
              <NavItem to="/settings" icon={<Settings size={18} />} label="Ajustes" />
            </nav>
            <div className="flex-1" />

            <button
              type="button"
              className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm text-[var(--wa-text)]/90 hover:bg-black/5 dark:hover:bg-white/5"
              onClick={() => {
                const next = toggleTheme();
                setThemeMode(next);
              }}
            >
              <span className="inline-flex items-center gap-2">
                <ThemeIcon size={18} />
                Tema
              </span>
              <span className="text-xs text-[var(--wa-subtext)]">{themeMode}</span>
            </button>

            <button
              className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-[var(--wa-text)]/90 hover:bg-black/5 dark:hover:bg-white/5"
              onClick={async () => {
                await supabase.auth.signOut();
                navigate("/login");
              }}
            >
              <LogOut size={18} />
              <span>Salir</span>
            </button>
          </aside>
        </div>
      ) : null}

      <main className="flex-1 min-w-0 pt-14 md:pt-0">
        <Outlet />
      </main>
    </div>
  );
}
