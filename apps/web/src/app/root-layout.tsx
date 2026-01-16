import React from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LogOut, MessageSquareText, Settings } from "lucide-react";
import { supabase } from "../lib/supabase";

function NavItem({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        `flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${isActive ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-200"}`
      }
    >
      {icon}
      <span>{label}</span>
    </NavLink>
  );
}

export function RootLayout() {
  const navigate = useNavigate();
  return (
    <div className="h-full w-full flex">
      <aside className="w-64 border-r bg-white p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2 px-2">
          <div className="h-8 w-8 rounded-xl bg-slate-900" />
          <div className="font-semibold">WhatsApp Manager</div>
        </div>
        <div className="h-px bg-slate-200" />
        <nav className="flex flex-col gap-1">
          <NavItem to="/" icon={<MessageSquareText size={18} />} label="Inbox" />
          <NavItem to="/settings" icon={<Settings size={18} />} label="Settings" />
        </nav>
        <div className="flex-1" />
        <button
          className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-700 hover:bg-slate-200"
          onClick={async () => {
            await supabase.auth.signOut();
            navigate("/login");
          }}
        >
          <LogOut size={18} />
          <span>Salir</span>
        </button>
      </aside>

      <main className="flex-1 min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
