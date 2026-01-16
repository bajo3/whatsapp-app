import { z } from "zod";
import { setCors, handlePreflight } from "../../_lib/cors";
import { env, supabaseHeaders } from "../../_lib/supabase";
import { requireAuth } from "../../_lib/auth";

const BodySchema = z.object({
  conversation_id: z.string().uuid(),
  text: z.string().min(1).max(4000),
});

async function resolvePhoneNumberId(dealershipId: string) {
  if (env.waPhoneNumberId) return env.waPhoneNumberId;

  const url =
    `${env.supabaseUrl}/rest/v1/wa_channels` +
    `?select=phone_number_id&dealership_id=eq.${dealershipId}&limit=1`;

  const r = await fetch(url, { headers: supabaseHeaders() });
  const rows = await r.json();
  return rows?.[0]?.phone_number_id ? String(rows[0].phone_number_id) : null;
}

async function sendWhatsAppText(phoneNumberId: string, toE164: string, text: string) {
  const graphUrl = `https://graph.facebook.com/${env.metaGraphVersion}/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to: toE164.replace("+", ""),
    type: "text",
    text: { body: text },
  };

  const r = await fetch(graphUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.waAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await r.json();
  if (!r.ok) {
    throw new Error(`whatsapp_send_failed: ${JSON.stringify(data)}`);
  }
  return data;
}

export default async function handler(req: any, res: any) {
  setCors(req, res);
  if (handlePreflight(req, res)) return;

  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    const auth = await requireAuth(req);
    const { conversation_id, text } = BodySchema.parse(req.body);

    // 1) cargar conversación + contacto
    const convUrl =
      `${env.supabaseUrl}/rest/v1/conversations` +
      `?select=id,dealership_id,contact:contact_id(phone_e164)` +
      `&id=eq.${conversation_id}&dealership_id=eq.${auth.dealershipId}&limit=1`;

    const convRes = await fetch(convUrl, { headers: supabaseHeaders() });
    const convRows = await convRes.json();
    const conv = convRows?.[0];
    if (!conv?.id) return res.status(404).json({ error: "conversation_not_found" });

    const to = conv?.contact?.phone_e164 as string | undefined;
    if (!to) return res.status(500).json({ error: "contact_missing_phone" });

    const phoneNumberId = await resolvePhoneNumberId(auth.dealershipId);
    if (!phoneNumberId) return res.status(500).json({ error: "missing_phone_number_id" });

    // 2) insertar mensaje “queued” (devolvemos representación para reconciliar con optimistic UI)
    const msgInsertUrl = `${env.supabaseUrl}/rest/v1/messages?select=id,conversation_id,direction,type,text_body,status,wa_message_id,created_at`;
    const msgInsertRes = await fetch(msgInsertUrl, {
      method: "POST",
      headers: {
        ...supabaseHeaders(),
        Prefer: "return=representation",
      },
      body: JSON.stringify([{
        dealership_id: auth.dealershipId,
        conversation_id,
        direction: "out",
        type: "text",
        text_body: text,
        status: "queued",
        created_by: auth.userId,
      }]),
    });

    const inserted = await msgInsertRes.json();
    const insertedRow = inserted?.[0];
    const msgId = insertedRow?.id;
    if (!msgId) throw new Error(`db_insert_message_failed: ${JSON.stringify(inserted)}`);

    // 3) enviar a WhatsApp
    let waMessageId: string | null = null;
    try {
      const waRes = await sendWhatsAppText(phoneNumberId, to, text);
      waMessageId = waRes?.messages?.[0]?.id || null;
    } catch (err: any) {
      // Si WhatsApp falla, marcamos failed para que el front ofrezca “Reintentar”
      await fetch(`${env.supabaseUrl}/rest/v1/messages?id=eq.${msgId}`, {
        method: "PATCH",
        headers: supabaseHeaders(),
        body: JSON.stringify({ status: "failed" }),
      });
      return res.status(502).json({ error: "whatsapp_send_failed", detail: err?.message || String(err), message_id: msgId });
    }

    // 4) actualizar mensaje + conversación
    await fetch(`${env.supabaseUrl}/rest/v1/messages?id=eq.${msgId}`, {
      method: "PATCH",
      headers: supabaseHeaders(),
      body: JSON.stringify({ status: "sent", wa_message_id: waMessageId }),
    });

    await fetch(`${env.supabaseUrl}/rest/v1/conversations?id=eq.${conversation_id}`, {
      method: "PATCH",
      headers: supabaseHeaders(),
      body: JSON.stringify({ last_message_at: new Date().toISOString() }),
    });

    return res.status(200).json({
      ok: true,
      message_id: msgId,
      created_at: insertedRow?.created_at ?? new Date().toISOString(),
      status: "sent",
      wa_message_id: waMessageId,
    });
  } catch (e: any) {
    return res.status(400).json({ error: "send_text_error", detail: e?.message || String(e) });
  }
}
