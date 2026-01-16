// api/whatsapp/webhook.ts

function pickTextMessage(entry: any) {
  const changes = entry?.changes?.[0]?.value;
  const messages = changes?.messages;
  if (!messages?.length) return null;

  const msg = messages[0];
  const from = msg.from; // phone without "+"
  const wa_message_id = msg.id;
  const text_body = msg.text?.body ?? null;

  return { from, wa_message_id, text_body, raw: msg, value: changes };
}

async function supabaseInsert(payload: any) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const dealershipId = process.env.DEFAULT_DEALERSHIP_ID;

  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  if (!dealershipId) throw new Error("Missing DEFAULT_DEALERSHIP_ID");

  const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

  // 1) upsert contact
  const phone_e164 = payload.from.startsWith("+") ? payload.from : `+${payload.from}`;
  const contactUpsert = await fetch(`${url}/rest/v1/contacts?on_conflict=dealership_id,phone_e164`, {
    method: "POST",
    headers,
    body: JSON.stringify([{ dealership_id: dealershipId, phone_e164, name: null }]),
  });
  if (!contactUpsert.ok) throw new Error(`contacts upsert failed: ${await contactUpsert.text()}`);

  // 2) get contact id
  const contactRes = await fetch(
    `${url}/rest/v1/contacts?select=id&dealership_id=eq.${dealershipId}&phone_e164=eq.${encodeURIComponent(phone_e164)}`,
    { headers }
  );
  const contactRows = await contactRes.json();
  const contact_id = contactRows?.[0]?.id;
  if (!contact_id) throw new Error("contact_id not found after upsert");

  // 3) upsert conversation
  const convUpsert = await fetch(`${url}/rest/v1/conversations?on_conflict=dealership_id,contact_id`, {
    method: "POST",
    headers,
    body: JSON.stringify([{ dealership_id: dealershipId, contact_id, status: "open" }]),
  });
  if (!convUpsert.ok) throw new Error(`conversations upsert failed: ${await convUpsert.text()}`);

  // 4) get conversation id
  const convRes = await fetch(
    `${url}/rest/v1/conversations?select=id&dealership_id=eq.${dealershipId}&contact_id=eq.${contact_id}`,
    { headers }
  );
  const convRows = await convRes.json();
  const conversation_id = convRows?.[0]?.id;
  if (!conversation_id) throw new Error("conversation_id not found after upsert");

  // 5) insert message (dedupe by wa_message_id via unique index)
  const msgInsert = await fetch(`${url}/rest/v1/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify([{
      dealership_id: dealershipId,
      conversation_id,
      direction: "in",
      type: "text",
      text_body: payload.text_body,
      status: "delivered",
      wa_message_id: payload.wa_message_id,
      payload: payload.raw ?? {},
    }]),
  });

  if (!msgInsert.ok) {
    const txt = await msgInsert.text();
    // si ya existe (duplicado), no lo tratamos como error fatal
    if (!txt.includes("duplicate key")) throw new Error(`messages insert failed: ${txt}`);
  }
}

export default async function handler(req: any, res: any) {
  try {
    // Verificación GET (ya te anda)
    if (req.method === "GET") {
      const mode = req.query?.["hub.mode"];
      const token = req.query?.["hub.verify_token"];
      const challenge = req.query?.["hub.challenge"];
      if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
        return res.status(200).send(String(challenge));
      }
      return res.status(403).send("Forbidden");
    }

    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const entry = body?.entry?.[0];
    const parsed = pickTextMessage(entry);

    // Siempre 200 para que Meta no reintente
    if (!parsed) return res.status(200).json({ ok: true, ignored: true });

    await supabaseInsert(parsed);
    return res.status(200).json({ ok: true });
  } catch (e: any) {
    console.error("webhook error:", e?.message ?? e);
    return res.status(200).json({ ok: true }); // igual 200 para WhatsApp
  }
}
