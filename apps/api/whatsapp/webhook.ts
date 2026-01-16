// apps/api/whatsapp/webhook.ts
export default async function handler(req: any, res: any) {
  // Verificación (GET)
  if (req.method === "GET") {
    const mode = req.query?.["hub.mode"];
    const token = req.query?.["hub.verify_token"];
    const challenge = req.query?.["hub.challenge"];

    if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      return res.status(200).send(String(challenge));
    }
    return res.status(403).send("Forbidden");
  }

  // Eventos (POST)
  if (req.method === "POST") {
    // Aceptar evento para que Meta no reintente
    return res.status(200).json({ ok: true });
  }

  return res.status(405).send("Method Not Allowed");
}
