function need(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export const env = {
  supabaseUrl: need("SUPABASE_URL"),
  serviceKey: need("SUPABASE_SERVICE_ROLE_KEY"),
  jwtSecret: need("SUPABASE_JWT_SECRET"),
  defaultDealershipId: process.env.DEFAULT_DEALERSHIP_ID || "",
  waAccessToken: need("WHATSAPP_ACCESS_TOKEN"),
  metaGraphVersion: process.env.META_GRAPH_API_VERSION || "v24.0",
  // opcional: si no lo seteás, lo resolvemos desde wa_channels
  waPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
};

export function supabaseHeaders() {
  return {
    apikey: env.serviceKey,
    Authorization: `Bearer ${env.serviceKey}`,
    "Content-Type": "application/json",
  };
}
