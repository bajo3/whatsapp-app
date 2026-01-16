import jwt from "jsonwebtoken";
import { env, supabaseHeaders } from "./supabase";

export async function requireAuth(req: any) {
  const auth = req.headers?.authorization || "";
  if (!auth.startsWith("Bearer ")) throw new Error("missing_bearer");

  const token = auth.slice("Bearer ".length);
  const decoded = jwt.verify(token, env.jwtSecret) as any;
  const userId = decoded?.sub;
  if (!userId) throw new Error("invalid_jwt");

  // traer profile (dealership + role)
  const url =
    `${env.supabaseUrl}/rest/v1/profiles` +
    `?select=id,dealership_id,role&id=eq.${userId}`;

  const r = await fetch(url, { headers: supabaseHeaders() });
  const rows = await r.json();
  const profile = rows?.[0];

  if (!profile?.dealership_id) throw new Error("profile_missing");

  return {
    userId: String(profile.id),
    dealershipId: String(profile.dealership_id),
    role: String(profile.role),
  };
}
