// api/whatsapp/webhook.ts

type InboundMessage = {
  from: string; // "549..." (sin +)
  wa_message_id: string;
  type: string; // "text" | "image" | ...
  text_body: string | null;
  raw: any;
  timestamp_iso: string;
};

function parseInboundMessages(body: any): InboundMessage[] {
  const entry = body?.entry?.[0];
  const changes = entry?.changes?.[0]?.value;
  const messages = changes?.messages;
  if (!Array.isArray(messages) || messages.length === 0) return [];

  return messages.map((msg: any) => {
    const from = String(msg?.from ?? "");
    const wa_message_id = String(msg?.id ?? "");
    const type = String(msg?.type ?? "unknown");

    const timestamp_iso = msg?.timestamp
      ? new Date(Number(msg.timestamp) * 1000).toISOString()
      : new Date().toISOString();

    const text_body =
      type === "text" && msg?.text?.body != null ? String(msg.text.body) : null;

    return { from, wa_message_id, type, text_body, raw: msg, timestamp_iso };
  }).filter(m => m.from && m.wa_message_id);
}

function getEnvOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

async function postgrestGetFirst(params: {
  baseUrl: string;
  serviceKey: string;
  table: string;
  select: string;
  filters: Record<string, string>;
}): Promise<any | null> {
  const { baseUrl, serviceKey, table, select, filters } = params;

  const qs = new URLSearchParams({ select, ...filters }).toString();
  const url = `${baseUrl}/rest/v1/${table}?${qs}`;

  const res = await fetch(url, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`${table} select failed: ${text}`);

  let json: any;
  try {
    json = text ? JSON.parse(text) : [];
  } catch {
    json = [];
  }

  return Array.isArray(json) && json.length ? json[0] : null;
}

async function postgrestUpsertReturningId(params: {
  baseUrl: string;
  serviceKey: string;
  table: string;
  onConflict: string;
  row: Record<string, any>;
}): Promise<string> {
  const { baseUrl, serviceKey, table, onConflict, row } = params;

  // Pedimos id en el mismo upsert:
  // - select=id en la URL
  // - Prefer: resolution=merge-duplicates (upsert real)
  // - Prefer: return=representation (devuelve filas)
  const url = `${baseUrl}/rest/v1/${table}?select=id&on_conflict=${encodeURIComponent(onConflict)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify([row]),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${table} upsert failed: ${text}`);
  }

  // PostgREST devuelve un array JSON con la representación
  let json: any;
  try {
    json = text ? JSON.parse(text) : [];
  } catch {
    json = [];
  }

  const id = json?.[0]?.id;
  if (!id) throw new Error(`${table} upsert did not return id`);
  return String(id);
}

async function insertMessage(params: {
  baseUrl: string;
  serviceKey: string;
  dealershipId: string;
  conversationId: string;
  msg: InboundMessage;
}): Promise<void> {
  const { baseUrl, serviceKey, dealershipId, conversationId, msg } = params;

  const res = await fetch(`${baseUrl}/rest/v1/messages`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([{
      dealership_id: dealershipId,
      conversation_id: conversationId,
      direction: "in",
      type: msg.type || "unknown",
      text_body: msg.text_body,
      status: "delivered",
      wa_message_id: msg.wa_message_id,
      payload: msg.raw ?? {},
    }]),
  });

  if (!res.ok) {
    const t = await res.text();
    // si entra el mismo evento dos veces, el unique(wa_message_id) puede chocar -> lo ignoramos
    if (t.includes('"code":"23505"') || t.toLowerCase().includes("duplicate key")) return;
    throw new Error(`messages insert failed: ${t}`);
  }
}

async function resolveDealershipId(params: {
  baseUrl: string;
  serviceKey: string;
  body: any;
}): Promise<string> {
  const { baseUrl, serviceKey, body } = params;

  const phoneNumberId: string | null =
    body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id || null;

  if (phoneNumberId) {
    const row = await postgrestGetFirst({
      baseUrl,
      serviceKey,
      table: "wa_channels",
      select: "dealership_id",
      filters: { phone_number_id: `eq.${phoneNumberId}`, limit: "1" },
    });
    if (row?.dealership_id) return String(row.dealership_id);
  }

  // fallback single-tenant mode
  return getEnvOrThrow("DEFAULT_DEALERSHIP_ID");
}

async function getOrCreateConversation(params: {
  baseUrl: string;
  serviceKey: string;
  dealershipId: string;
  contactId: string;
  tsIso: string;
}): Promise<string> {
  const { baseUrl, serviceKey, dealershipId, contactId, tsIso } = params;

  const existing = await postgrestGetFirst({
    baseUrl,
    serviceKey,
    table: "conversations",
    select: "id,unread_count",
    filters: {
      dealership_id: `eq.${dealershipId}`,
      contact_id: `eq.${contactId}`,
      limit: "1",
    },
  });

  if (!existing?.id) {
    const url = `${baseUrl}/rest/v1/conversations?select=id`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify([
        {
          dealership_id: dealershipId,
          contact_id: contactId,
          status: "open",
          unread_count: 1,
          last_message_at: tsIso,
        },
      ]),
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`conversations insert failed: ${text}`);
    const json = text ? JSON.parse(text) : [];
    const id = json?.[0]?.id;
    if (!id) throw new Error("conversations insert did not return id");
    return String(id);
  }

  // update last_message_at + increment unread_count
  const currentUnread = Number(existing.unread_count ?? 0);
  const newUnread = currentUnread + 1;

  const patchUrl = `${baseUrl}/rest/v1/conversations?id=eq.${existing.id}`;
  const patchRes = await fetch(patchUrl, {
    method: "PATCH",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ last_message_at: tsIso, unread_count: newUnread, status: "open" }),
  });
  if (!patchRes.ok) {
    const t = await patchRes.text();
    throw new Error(`conversations update failed: ${t}`);
  }

  return String(existing.id);
}

async function handleInboundToSupabase(params: {
  baseUrl: string;
  serviceKey: string;
  dealershipId: string;
  msg: InboundMessage;
}) {
  const { baseUrl, serviceKey, dealershipId, msg } = params;

  const phone_e164 = msg.from.startsWith("+") ? msg.from : `+${msg.from}`;

  // 1) Upsert contact -> devuelve id
  const contactId = await postgrestUpsertReturningId({
    baseUrl,
    serviceKey,
    table: "contacts",
    onConflict: "dealership_id,phone_e164",
    row: {
      dealership_id: dealershipId,
      phone_e164,
      name: null,
      last_seen_at: msg.timestamp_iso,
    },
  });

  // 2) Get/Create conversation + update counters
  const conversationId = await getOrCreateConversation({
    baseUrl,
    serviceKey,
    dealershipId,
    contactId,
    tsIso: msg.timestamp_iso,
  });

  // 3) Insert message (dedupe por wa_message_id)
  await insertMessage({
    baseUrl,
    serviceKey,
    dealershipId,
    conversationId,
    msg,
  });
}

export default async function handler(req: any, res: any) {
  try {
    // GET: verificación Meta
    if (req.method === "GET") {
      const mode = req.query?.["hub.mode"];
      const token = req.query?.["hub.verify_token"];
      const challenge = req.query?.["hub.challenge"];

      if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
        return res.status(200).send(String(challenge));
      }
      return res.status(403).send("Forbidden");
    }

    // POST: eventos
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const baseUrl = getEnvOrThrow("SUPABASE_URL");
    const serviceKey = getEnvOrThrow("SUPABASE_SERVICE_ROLE_KEY");
    const dealershipId = await resolveDealershipId({ baseUrl, serviceKey, body });

    const inbound = parseInboundMessages(body);

    // Siempre 200 para que Meta no reintente. Si no hay messages, lo ignoramos.
    if (inbound.length === 0) {
      return res.status(200).json({ ok: true, ignored: true });
    }

    // Procesamos todos los mensajes del payload (a veces vienen varios)
    for (const msg of inbound) {
      try {
        await handleInboundToSupabase({ baseUrl, serviceKey, dealershipId, msg });
      } catch (e: any) {
        // Log, pero no cortamos: respondemos 200 igual
        console.error("webhook message error:", e?.message ?? e);
      }
    }

    return res.status(200).json({ ok: true, count: inbound.length });
  } catch (e: any) {
    console.error("webhook error:", e?.message ?? e);
    // 200 igual (Meta)
    return res.status(200).json({ ok: true });
  }
}
