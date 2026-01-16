import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

let cachedSession: Session | null = null;
let initialized = false;

async function init() {
  if (initialized) return;
  initialized = true;
  const { data } = await supabase.auth.getSession();
  cachedSession = data.session;
  supabase.auth.onAuthStateChange((_event, session) => {
    cachedSession = session;
  });
}

export async function getSession(): Promise<Session | null> {
  await init();
  return cachedSession;
}

export async function requireSession(): Promise<boolean> {
  return (await getSession()) != null;
}
