import React from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LogOut, Menu, MessageSquareText, Moon, Settings, Sun } from "lucide-react";
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
            ? "bg-slate-900 text-white dark:bg-slate-200 dark:text-slate-900"
            : "text-slate-700 dark:text-slate-200 hover:bg-black/5 dark:hover:bg-white/10"
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
    <div className="h-full w-full flex bg-[var(--app-bg)]">
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-[var(--app-card)] border-b border-[var(--app-border)] z-30 flex items-center justify-between px-3">
        <button
          type="button"
          className="h-10 w-10 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 inline-flex items-center justify-center"
          onClick={() => setMobileNavOpen(true)}
          aria-label="Abrir menú"
        >
          <Menu size={20} />
        </button>
        <div className="font-semibold text-sm">WhatsApp Manager</div>
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
      <aside className="hidden md:flex w-64 border-r border-[var(--app-border)] bg-[var(--app-card)] p-4 flex-col gap-3">
        <div className="flex items-center gap-2 px-2">
          <div className="h-8 w-8 rounded-xl bg-slate-900 dark:bg-slate-200" />
          <div className="font-semibold">WhatsApp Manager</div>
        </div>
        <div className="h-px bg-[var(--app-border)]" />
        <nav className="flex flex-col gap-1">
          <NavItem to="/" icon={<MessageSquareText size={18} />} label="Inbox" />
          <NavItem to="/settings" icon={<Settings size={18} />} label="Settings" />
        </nav>
        <div className="flex-1" />

        <button
          type="button"
          className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-black/5 dark:hover:bg-white/10"
          onClick={() => {
            const next = toggleTheme();
            setThemeMode(next);
          }}
        >
          <span className="inline-flex items-center gap-2">
            <ThemeIcon size={18} />
            Tema
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400">{themeMode}</span>
        </button>

        <button
          className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-black/5 dark:hover:bg-white/10"
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
          <aside className="absolute top-0 left-0 h-full w-72 bg-[var(--app-card)] border-r border-[var(--app-border)] p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 px-2">
              <div className="h-8 w-8 rounded-xl bg-slate-900 dark:bg-slate-200" />
              <div className="font-semibold">WhatsApp Manager</div>
            </div>
            <div className="h-px bg-[var(--app-border)]" />
            <nav className="flex flex-col gap-1" onClick={() => setMobileNavOpen(false)}>
              <NavItem to="/" icon={<MessageSquareText size={18} />} label="Inbox" />
              <NavItem to="/settings" icon={<Settings size={18} />} label="Settings" />
            </nav>
            <div className="flex-1" />

            <button
              type="button"
              className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-black/5 dark:hover:bg-white/10"
              onClick={() => {
                const next = toggleTheme();
                setThemeMode(next);
              }}
            >
              <span className="inline-flex items-center gap-2">
                <ThemeIcon size={18} />
                Tema
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">{themeMode}</span>
            </button>

            <button
              className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-black/5 dark:hover:bg-white/10"
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
