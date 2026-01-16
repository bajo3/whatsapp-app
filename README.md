# WhatsApp Manager (Cloud API) — React Router + Supabase

Un MVP completo (hasta **MVP 5**) para manejar WhatsApp **Cloud API** con una bandeja multiusuario.

## Incluye

### MVP 1 — Bandeja + operación
- Inbox (lista de conversaciones)
- Vista de chat + envío de texto
- Webhook para mensajes entrantes
- Tracking de estados (sent/delivered/read/failed)

### MVP 2 — Operación pro
- Asignación a vendedor (assigned_to)
- Tags/etiquetas por conversación
- Notas internas (tabla preparada)

### MVP 3 — Bot guiado (UI-ready)
- Preparado para usar botones/listas (API + DB payload)
- Handoff a asesor (asignación + tags)

### MVP 4 — Templates oficiales
- Endpoint para enviar templates (fuera de ventana)
- Tabla `wa_templates` para que los mantengas desde UI

### MVP 5 — Flows
- Endpoint `send_flow` (stub) + estructura en DB/UI para extender

## Stack
- Web: Vite + React + TypeScript + React Router + Tailwind
- API: Node + Express + Supabase Admin + verificación JWT
- DB: Supabase (Postgres + RLS)

## Carpeta de setup
Ver `docs/SETUP.md`.

## Ejecutar

```bash
npm i
npm run dev:api
npm run dev
```

## Seguridad
- La web usa el token de Supabase (Bearer) para llamar al API.
- El API verifica el JWT con `SUPABASE_JWT_SECRET` y obtiene `dealership_id` desde `profiles`.
- El webhook usa service role y mapea `phone_number_id -> dealership_id` vía `wa_channels`.

---

Si querés que el inbox tenga también:
- **respuestas rápidas desde el chat**
- **templates desde el chat**
- **snooze / cerrar conversación**
- **vista de pendientes (followups)**

se agregan en 1 iteración más sobre esta base.
