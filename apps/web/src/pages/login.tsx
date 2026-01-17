import React from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return setError(error.message);
    navigate("/");
  }

  async function signUp() {
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (error) return setError(error.message);
    setError("Cuenta creada. Si tenés confirmación por email activada, confirmá y luego logueate.");
  }

  return (
    <div className="h-full w-full grid place-items-center p-4 bg-[var(--app-bg)]">
      <div className="w-full max-w-md rounded-2xl bg-[var(--app-card)] shadow-sm border border-[var(--app-border)] p-6">
        <div className="text-xl font-semibold">Ingresar</div>
        <div className="text-sm text-slate-600 dark:text-slate-300 mt-1">Accedé al gestor de WhatsApp Cloud API</div>

        <form onSubmit={signIn} className="mt-6 flex flex-col gap-3">
          <label className="text-sm">
            <div className="mb-1 text-slate-700 dark:text-slate-200">Email</div>
            <input
              className="w-full rounded-xl border border-[var(--app-border)] bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-slate-900/20 dark:focus:ring-slate-200/20"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
            />
          </label>

          <label className="text-sm">
            <div className="mb-1 text-slate-700 dark:text-slate-200">Contraseña</div>
            <input
              className="w-full rounded-xl border border-[var(--app-border)] bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-slate-900/20 dark:focus:ring-slate-200/20"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
            />
          </label>

          {error ? (
            <div className="rounded-xl bg-red-50 text-red-800 border border-red-200 px-3 py-2 text-sm dark:bg-red-950/30 dark:text-red-200 dark:border-red-900/50">{error}</div>
          ) : null}

          <button
            disabled={loading}
            className="rounded-xl bg-slate-900 text-white dark:bg-slate-200 dark:text-slate-900 px-3 py-2 text-sm hover:opacity-95 disabled:opacity-60"
            type="submit"
          >
            {loading ? "Cargando..." : "Entrar"}
          </button>

          <button
            type="button"
            disabled={loading}
            onClick={signUp}
            className="rounded-xl border border-[var(--app-border)] px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-60"
          >
            Crear cuenta
          </button>

          <div className="text-xs text-slate-500 dark:text-slate-400">
            Nota: en producción, lo normal es que el admin cree usuarios y asigne dealership/roles en la tabla <code>profiles</code>.
          </div>
        </form>
      </div>
    </div>
  );
}
