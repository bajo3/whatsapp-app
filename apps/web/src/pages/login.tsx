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
    <div className="h-full w-full grid place-items-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-sm border p-6">
        <div className="text-xl font-semibold">Ingresar</div>
        <div className="text-sm text-slate-600 mt-1">Accedé al gestor de WhatsApp Cloud API</div>

        <form onSubmit={signIn} className="mt-6 flex flex-col gap-3">
          <label className="text-sm">
            <div className="mb-1 text-slate-700">Email</div>
            <input
              className="w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-slate-900/20"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
            />
          </label>

          <label className="text-sm">
            <div className="mb-1 text-slate-700">Contraseña</div>
            <input
              className="w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-slate-900/20"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
            />
          </label>

          {error ? (
            <div className="rounded-xl bg-red-50 text-red-800 border border-red-200 px-3 py-2 text-sm">{error}</div>
          ) : null}

          <button
            disabled={loading}
            className="rounded-xl bg-slate-900 text-white px-3 py-2 text-sm hover:opacity-95 disabled:opacity-60"
            type="submit"
          >
            {loading ? "Cargando..." : "Entrar"}
          </button>

          <button
            type="button"
            disabled={loading}
            onClick={signUp}
            className="rounded-xl border px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-60"
          >
            Crear cuenta
          </button>

          <div className="text-xs text-slate-500">
            Nota: en producción, lo normal es que el admin cree usuarios y asigne dealership/roles en la tabla <code>profiles</code>.
          </div>
        </form>
      </div>
    </div>
  );
}
