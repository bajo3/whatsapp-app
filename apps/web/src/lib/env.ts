export const env = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL as string,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL as string) || "http://localhost:8787",
};

export function assertEnv() {
  const missing: string[] = [];
  if (!env.supabaseUrl) missing.push("VITE_SUPABASE_URL");
  if (!env.supabaseAnonKey) missing.push("VITE_SUPABASE_ANON_KEY");
  if (missing.length) {
    throw new Error(`Missing env: ${missing.join(", ")}`);
  }
}
