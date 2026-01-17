import express from "express";
import cors from "cors";
import { request } from "undici";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import crypto from "crypto";

type AuthedReq = express.Request & {
  rawBody?: Buffer;
  auth?: {
    userId: string;
    dealershipId: string;
    role: string;
  };
};

const env = {
  port: parseInt(process.env.PORT || "8787", 10),
  corsOrigin: process.env.CORS_ORIGIN || "*",
  supabaseUrl: process.env.SUPABASE_URL || "",
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  metaGraphVersion: process.env.META_GRAPH_API_VERSION || "v20.0",
  waPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
  waWabaId: process.env.WHATSAPP_WABA_ID || "",
  waAccessToken: process.env.WHATSAPP_ACCESS_TOKEN || "",
  waVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "",
  metaAppSecret: process.env.META_APP_SECRET || "",
  defaultDealershipId: process.env.DEFAULT_DEALERSHIP_ID || "",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-5",
};

if (!env.supabaseUrl || !env.supabaseServiceKey) {
  console.warn("[warn] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabaseAdmin = createClient(env.supabaseUrl, env.supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const app = express();

// -----------------------------
// CORS (robust)
// -----------------------------
// We reflect the request Origin only if it's explicitly allowed.
// This prevents the classic production bug where CORS_ORIGIN was left as
// http://localhost:5173 and blocks https://*.vercel.app.
const DEFAULT_ALLOWED_ORIGINS = [
  "https://whatsapp-app-web.vercel.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

function buildAllowedOrigins(raw: string) {
  const trimmed = String(raw || "").trim();
  const parts = trimmed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const allowAll = parts.includes("*");
  const set = new Set<string>([...DEFAULT_ALLOWED_ORIGINS, ...parts]);

  // Allow Vercel preview domains for the web project (optional but very handy).
  const vercelWebPreview = /^https:\/\/whatsapp-app-web-[a-z0-9-]+\.vercel\.app$/i;

  return {
    allowAll,
    set,
    vercelWebPreview,
    isAllowed(origin: string) {
      if (allowAll) return true;
      if (set.has(origin)) return true;
      if (vercelWebPreview.test(origin)) return true;
      return false;
    },
  };
}

const allowed = buildAllowedOrigins(env.corsOrigin);

const corsOptions: cors.CorsOptions = {
  origin: (origin, cb) => {
    // Non-browser requests (no Origin) -> allow.
    if (!origin) return cb(null, true);
    if (allowed.isAllowed(origin)) return cb(null, true);
    return cb(null, false);
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  maxAge: 86400,
};

app.use(cors(corsOptions));

// Ensure OPTIONS preflight works for all routes (esp. when no route matches)
app.options("*", cors(corsOptions));
app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.get("/v1/health", (_req, res) => {
  res.json({ ok: true });
});

// -----------------------------
// Auth middleware (Supabase JWT)
// -----------------------------
async function authRequired(req: AuthedReq, res: express.Response, next: express.NextFunction) {
  try {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return res.status(401).json({ error: "missing_bearer" });
    const token = auth.slice("Bearer ".length);

    // Supabase tokens can be HS256 (jwt_secret) or asymmetric (e.g. ES256 + JWKS).
    // To avoid signature mismatches, we validate the token against Supabase Auth.
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user?.id) {
      return res.status(401).json({ error: "unauthorized", detail: userErr?.message || "invalid_token" });
    }

    const userId = userData.user.id;

    const { data: profile, error } = await supabaseAdmin
      .from("profiles")
      .select("id,dealership_id,role")
      .eq("id", userId)
      .maybeSingle();

    if (error) return res.status(500).json({ error: "profile_query_error", detail: error.message });
    if (!profile) return res.status(403).json({ error: "profile_missing" });

    req.auth = {
      userId,
      dealershipId: profile.dealership_id,
      role: profile.role,
    };
    next();
  } catch (e: any) {
    return res.status(401).json({ error: "unauthorized", detail: e?.message || String(e) });
  }
}

// -----------------------------
// WhatsApp Webhook (Cloud API)
// -----------------------------
// Verification handshake
app.get("/v1/wa/webhook", (req, res) => {
  const mode = String(req.query["hub.mode"] || "");
  const token = String(req.query["hub.verify_token"] || "");
  const challenge = String(req.query["hub.challenge"] || "");

  if (mode === "subscribe" && token && token === env.waVerifyToken) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Signature verification (optional, recommended)
function verifyMetaSignature(req: AuthedReq): boolean {
  if (!env.metaAppSecret) return true; // allow if not configured
  const sig = req.headers["x-hub-signature-256"] as string | undefined;
  if (!sig?.startsWith("sha256=")) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", env.metaAppSecret).update(req.rawBody || Buffer.from(""))
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

const WhatsAppWebhookSchema = z.any();

app.post("/v1/wa/webhook", async (req: AuthedReq, res) => {
  try {
    if (!verifyMetaSignature(req)) {
      return res.status(401).json({ error: "invalid_signature" });
    }

    const body = WhatsAppWebhookSchema.parse(req.body);

    // Extract phone_number_id from metadata
    const phoneNumberId: string | null = body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id || null;

    let dealershipId: string | null = null;
    if (phoneNumberId) {
      const { data } = await supabaseAdmin
        .from("wa_channels")
        .select("dealership_id")
        .eq("phone_number_id", phoneNumberId)
        .maybeSingle();
      dealershipId = data?.dealership_id || null;
    }
    dealershipId = dealershipId || env.defaultDealershipId || null;
    if (!dealershipId) {
      return res.status(500).json({ error: "missing_dealership_mapping" });
    }

    const value = body?.entry?.[0]?.changes?.[0]?.value;

    // Incoming messages
    const messages = value?.messages || [];
    for (const m of messages) {
      const from = m.from; // wa id (phone)
      const text = m?.text?.body ?? null;
      const waMessageId = m?.id ?? null;
      const ts = m?.timestamp ? new Date(parseInt(m.timestamp, 10) * 1000).toISOString() : new Date().toISOString();

      // Upsert contact
      const phone_e164 = from.startsWith("+") ? from : `+${from}`;
      const { data: contact, error: cErr } = await supabaseAdmin
        .from("contacts")
        .upsert(
          {
            dealership_id: dealershipId,
            phone_e164,
            last_seen_at: ts,
          },
          { onConflict: "dealership_id,phone_e164" }
        )
        .select("id")
        .single();
      if (cErr) throw new Error(`contact_upsert: ${cErr.message}`);

      // Find or create conversation
      const { data: existingConv, error: convFindErr } = await supabaseAdmin
        .from("conversations")
        .select("id,unread_count")
        .eq("dealership_id", dealershipId)
        .eq("contact_id", contact.id)
        .maybeSingle();
      if (convFindErr) throw new Error(`conv_find: ${convFindErr.message}`);

      let conversationId = existingConv?.id as string | undefined;
      if (!conversationId) {
        const { data: newConv, error: convInsErr } = await supabaseAdmin
          .from("conversations")
          .insert({
            dealership_id: dealershipId,
            contact_id: contact.id,
            status: "open",
            unread_count: 1,
            last_message_at: ts,
          })
          .select("id")
          .single();
        if (convInsErr) throw new Error(`conv_insert: ${convInsErr.message}`);
        conversationId = newConv.id;
      } else {
        const unread = (existingConv?.unread_count || 0) + 1;
        const { error: convUpdErr } = await supabaseAdmin
          .from("conversations")
          .update({ unread_count: unread, last_message_at: ts })
          .eq("id", conversationId);
        if (convUpdErr) throw new Error(`conv_update: ${convUpdErr.message}`);
      }

      // Insert message
      const { error: msgErr } = await supabaseAdmin.from("messages").insert({
        dealership_id: dealershipId,
        conversation_id: conversationId,
        direction: "in",
        type: m.type || "text",
        text_body: text,
        status: "delivered",
        wa_message_id: waMessageId,
        created_at: ts,
        payload: m,
      });
      if (msgErr) {
        // ignore duplicates by wa_message_id
        if (!String(msgErr.message).includes("duplicate")) throw new Error(`msg_insert: ${msgErr.message}`);
      }
    }

    // Status updates for messages
    const statuses = value?.statuses || [];
    for (const s of statuses) {
      const waMessageId = s.id;
      const status = s.status; // sent/delivered/read/failed
      if (!waMessageId || !status) continue;
      const mapped = status === "sent" || status === "delivered" || status === "read" || status === "failed" ? status : "queued";
      await supabaseAdmin.from("messages").update({ status: mapped }).eq("wa_message_id", waMessageId);
    }

    res.json({ ok: true });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: "webhook_error", detail: e?.message || String(e) });
  }
});

// -----------------------------
// Outbound messaging (secure)
// -----------------------------
const SendTextSchema = z.object({
  conversation_id: z.string().uuid(),
  text: z.string().min(1).max(4000),
});

app.post("/v1/messages/send_text", authRequired, async (req: AuthedReq, res) => {
  try {
    const { conversation_id, text } = SendTextSchema.parse(req.body);
    const { dealershipId, userId } = req.auth!;

    // Load conversation + contact
    const { data: conv, error: convErr } = await supabaseAdmin
      .from("conversations")
      .select("id,contact:contact_id(phone_e164)")
      .eq("id", conversation_id)
      .eq("dealership_id", dealershipId)
      .single();
    if (convErr) return res.status(404).json({ error: "conversation_not_found" });

    const to = (conv as any).contact.phone_e164 as string;
    const phoneNumberId = env.waPhoneNumberId || (await resolvePhoneNumberId(dealershipId));
    if (!phoneNumberId) return res.status(500).json({ error: "missing_phone_number_id" });

    // Insert message row as queued
    const { data: msgRow, error: msgInsErr } = await supabaseAdmin
      .from("messages")
      .insert({
        dealership_id: dealershipId,
        conversation_id,
        direction: "out",
        type: "text",
        text_body: text,
        status: "queued",
        created_by: userId,
      })
      .select("id")
      .single();
    if (msgInsErr) throw new Error(msgInsErr.message);

    // Send to Meta
    const waRes = await sendWhatsAppMessage(phoneNumberId, {
      messaging_product: "whatsapp",
      to: to.replace("+", ""),
      type: "text",
      text: { body: text },
    });

    const waMessageId = waRes?.messages?.[0]?.id || null;
    await supabaseAdmin
      .from("messages")
      .update({ status: "sent", wa_message_id: waMessageId })
      .eq("id", msgRow.id);

    // Update conversation last_message_at
    await supabaseAdmin.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", conversation_id);

    res.json({ ok: true, wa_message_id: waMessageId });
  } catch (e: any) {
    res.status(400).json({ error: "send_text_error", detail: e?.message || String(e) });
  }
});

const SendTemplateSchema = z.object({
  conversation_id: z.string().uuid(),
  template_name: z.string().min(1),
  language: z.string().min(2).default("es_AR"),
  // array of strings for BODY variables ({{1}}, {{2}}, ...)
  body_vars: z.array(z.string()).default([]),
});

app.post("/v1/messages/send_template", authRequired, async (req: AuthedReq, res) => {
  try {
    const { conversation_id, template_name, language, body_vars } = SendTemplateSchema.parse(req.body);
    const { dealershipId, userId } = req.auth!;

    const { data: conv, error: convErr } = await supabaseAdmin
      .from("conversations")
      .select("id,contact:contact_id(phone_e164)")
      .eq("id", conversation_id)
      .eq("dealership_id", dealershipId)
      .single();
    if (convErr) return res.status(404).json({ error: "conversation_not_found" });

    const to = (conv as any).contact.phone_e164 as string;
    const phoneNumberId = env.waPhoneNumberId || (await resolvePhoneNumberId(dealershipId));
    if (!phoneNumberId) return res.status(500).json({ error: "missing_phone_number_id" });

    const components = body_vars.length
      ? [
          {
            type: "body",
            parameters: body_vars.map((v) => ({ type: "text", text: v })),
          },
        ]
      : [];

    const { data: msgRow, error: msgInsErr } = await supabaseAdmin
      .from("messages")
      .insert({
        dealership_id: dealershipId,
        conversation_id,
        direction: "out",
        type: "template",
        text_body: `[TEMPLATE] ${template_name}`,
        status: "queued",
        created_by: userId,
        payload: { template_name, language, body_vars },
      })
      .select("id")
      .single();
    if (msgInsErr) throw new Error(msgInsErr.message);

    const waRes = await sendWhatsAppMessage(phoneNumberId, {
      messaging_product: "whatsapp",
      to: to.replace("+", ""),
      type: "template",
      template: {
        name: template_name,
        language: { code: language },
        ...(components.length ? { components } : {}),
      },
    });

    const waMessageId = waRes?.messages?.[0]?.id || null;
    await supabaseAdmin.from("messages").update({ status: "sent", wa_message_id: waMessageId }).eq("id", msgRow.id);
    await supabaseAdmin.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", conversation_id);

    res.json({ ok: true, wa_message_id: waMessageId });
  } catch (e: any) {
    res.status(400).json({ error: "send_template_error", detail: e?.message || String(e) });
  }
});

// MVP 5: Flows endpoint (stub) — you can wire actual Flow payload once enabled in your WABA
const SendFlowSchema = z.object({
  conversation_id: z.string().uuid(),
  flow_id: z.string().min(1),
  cta_text: z.string().min(1).default("Completar"),
  body_text: z.string().min(1).default("Continuemos por aquí"),
});

app.post("/v1/messages/send_flow", authRequired, async (req: AuthedReq, res) => {
  try {
    const { conversation_id, flow_id, cta_text, body_text } = SendFlowSchema.parse(req.body);
    const { dealershipId, userId } = req.auth!;

    const { data: conv, error: convErr } = await supabaseAdmin
      .from("conversations")
      .select("id,contact:contact_id(phone_e164)")
      .eq("id", conversation_id)
      .eq("dealership_id", dealershipId)
      .single();
    if (convErr) return res.status(404).json({ error: "conversation_not_found" });

    const to = (conv as any).contact.phone_e164 as string;
    const phoneNumberId = env.waPhoneNumberId || (await resolvePhoneNumberId(dealershipId));
    if (!phoneNumberId) return res.status(500).json({ error: "missing_phone_number_id" });

    const { data: msgRow, error: msgInsErr } = await supabaseAdmin
      .from("messages")
      .insert({
        dealership_id: dealershipId,
        conversation_id,
        direction: "out",
        type: "flow",
        text_body: `[FLOW] ${flow_id}`,
        status: "queued",
        created_by: userId,
        payload: { flow_id, cta_text, body_text },
      })
      .select("id")
      .single();
    if (msgInsErr) throw new Error(msgInsErr.message);

    // NOTE: This payload is a placeholder. When Flows are enabled, adjust to the exact flow message schema.
    const waRes = await sendWhatsAppMessage(phoneNumberId, {
      messaging_product: "whatsapp",
      to: to.replace("+", ""),
      type: "interactive",
      interactive: {
        type: "flow",
        body: { text: body_text },
        action: {
          name: "flow",
          parameters: {
            flow_id,
            flow_message_version: "3",
            flow_cta: cta_text,
            flow_token: crypto.randomUUID(),
          },
        },
      },
    });

    const waMessageId = waRes?.messages?.[0]?.id || null;
    await supabaseAdmin.from("messages").update({ status: "sent", wa_message_id: waMessageId }).eq("id", msgRow.id);
    await supabaseAdmin.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", conversation_id);

    res.json({ ok: true, wa_message_id: waMessageId });
  } catch (e: any) {
    res.status(400).json({ error: "send_flow_error", detail: e?.message || String(e) });
  }
});

app.post("/v1/templates/sync", authRequired, async (_req: AuthedReq, res) => {
  // Stub: optional endpoint if you later implement Meta template fetch.
  res.json({ ok: true, note: "Not implemented in MVP (leave templates managed in DB)" });
});

app.post("/v1/ai/suggest_reply", authRequired, async (req: AuthedReq, res) => {
  try {
    const body = z
      .object({ conversation_id: z.string().min(1) })
      .parse(req.body);

    if (!env.openaiApiKey) {
      return res.status(501).json({ ok: false, error: "OPENAI_API_KEY not set" });
    }

    const { data: msgs, error: mErr } = await supabaseAdmin
      .from("messages")
      .select("direction, body, created_at")
      .eq("conversation_id", body.conversation_id)
      .order("created_at", { ascending: true })
      .limit(30);
    if (mErr) throw mErr;

    const { data: conv } = await supabaseAdmin
      .from("conversations")
      .select("id, contact_id")
      .eq("id", body.conversation_id)
      .maybeSingle();

    let contactLine = "";
    if (conv?.contact_id) {
      const { data: contact } = await supabaseAdmin
        .from("contacts")
        .select("name, phone_e164")
        .eq("id", conv.contact_id)
        .maybeSingle();
      if (contact) contactLine = `Contacto: ${contact.name || "(sin nombre)"} — ${contact.phone_e164}`;
    }

    const transcript = (msgs || [])
      .map((m: any) => {
        const who = m.direction === "out" ? "Vendedor" : "Cliente";
        return `${who}: ${String(m.body || "").trim()}`;
      })
      .filter(Boolean)
      .join("\n");

    const prompt = `Sos un vendedor de autos en Argentina y estás respondiendo por WhatsApp.\n\nObjetivo: responder de forma clara, rápida, amable y orientada a cerrar, SIN presionar, y siempre con una pregunta concreta para avanzar (presupuesto, permuta, financiación, disponibilidad, ubicación).\n\nReglas:\n- Máximo 3-5 líneas\n- Español rioplatense\n- No inventes datos que no estén en el chat\n- Si falta info, pedila\n\n${contactLine}\n\nChat:\n${transcript}\n\nEscribí una respuesta sugerida (solo el texto del mensaje).`;

    const { statusCode, body: respBody } = await request("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.openaiModel,
        input: prompt,
        max_output_tokens: 200,
      }),
    });

    const raw = await respBody.text();
    let json: any = null;
    try {
      json = JSON.parse(raw);
    } catch {
      // ignore
    }

    if (statusCode < 200 || statusCode >= 300) {
      return res.status(500).json({ ok: false, error: `OpenAI error ${statusCode}: ${raw}` });
    }

    const text =
      (json && (json.output_text || json?.output?.[0]?.content?.[0]?.text)) ||
      "";

    return res.json({ ok: true, text: String(text).trim() });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Bad request" });
  }
});

async function resolvePhoneNumberId(dealershipId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("wa_channels")
    .select("phone_number_id")
    .eq("dealership_id", dealershipId)
    .maybeSingle();
  return data?.phone_number_id || null;
}

async function sendWhatsAppMessage(phoneNumberId: string, payload: any): Promise<any> {
  if (!env.waAccessToken) throw new Error("Missing WHATSAPP_ACCESS_TOKEN");
  const url = `https://graph.facebook.com/${env.metaGraphVersion}/${phoneNumberId}/messages`;

  const { statusCode, body } = await request(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.waAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await body.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`Meta API error ${statusCode}: ${text}`);
  }
  return json || { ok: true };
}

app.listen(env.port, () => {
  console.log(`[wm-api] listening on http://localhost:${env.port}`);
});
