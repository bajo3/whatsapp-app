// api/whatsapp/webhook.ts

type InboundMessage = {
  from: string; // "549..." (sin +)
  wa_message_id: string;
  type: string; // "text" | "image" | ...
  text_body: string | null;
  raw: any;
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

    const text_body =
      type === "text" && msg?.text?.body != null ? String(msg.text.body) : null;

    return { from, wa_message_id, type, text_body, raw: msg };
  }).filter(m => m.from && m.wa_message_id);
}

function getEnvOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
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

async function handleInboundToSupabase(msg: InboundMessage) {
  const baseUrl = getEnvOrThrow("SUPABASE_URL");
  const serviceKey = getEnvOrThrow("SUPABASE_SERVICE_ROLE_KEY");
  const dealershipId = getEnvOrThrow("DEFAULT_DEALERSHIP_ID");

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
    },
  });

  // 2) Upsert conversation -> devuelve id
  const conversationId = await postgrestUpsertReturningId({
    baseUrl,
    serviceKey,
    table: "conversations",
    onConflict: "dealership_id,contact_id",
    row: {
      dealership_id: dealershipId,
      contact_id: contactId,
      status: "open",
    },
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

    const inbound = parseInboundMessages(body);

    // Siempre 200 para que Meta no reintente. Si no hay messages, lo ignoramos.
    if (inbound.length === 0) {
      return res.status(200).json({ ok: true, ignored: true });
    }

    // Procesamos todos los mensajes del payload (a veces vienen varios)
    for (const msg of inbound) {
      try {
        await handleInboundToSupabase(msg);
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
