# Setup rápido (dev)

## 1) Crear proyecto Supabase
1. Crear proyecto.
2. En SQL Editor correr: `supabase/migrations/001_init.sql`.

## 2) Crear una concesionaria y tu perfil (admin)
Como `profiles` referencia `auth.users`, el flujo recomendado es:

1. En la web, crear cuenta (Login -> "Crear cuenta").
2. En Supabase Dashboard -> Table Editor -> `dealerships`: crear un registro.
3. En `profiles`: crear registro con:
   - `id` = el UID del user (Auth -> Users)
   - `dealership_id` = tu dealership
   - `role` = `admin`
   - `full_name` = (opcional)

## 3) Configurar canal de WhatsApp (mapeo)
En `wa_channels` crear:
- `dealership_id`
- `phone_number_id`
- `waba_id` (opcional)

## 4) Backend API
Copia `.env.example` a `.env` en `apps/api` y completa:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_JWT_SECRET` (Settings -> API -> JWT Secret)
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_VERIFY_TOKEN`
- `META_APP_SECRET` (opcional, para validar firma del webhook)
- `DEFAULT_DEALERSHIP_ID` (si solo vas a usar 1)

Ejecutar:
- `npm i` en la raíz (workspaces)
- `npm run dev:api`

## 5) Web
En `apps/web`:
- copiar `.env.example` a `.env`
- setear `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`
- setear `VITE_API_BASE_URL=http://localhost:8787`

Ejecutar:
- `npm run dev`

## 6) Webhook de WhatsApp
En Meta Developers:
- Callback URL: `https://TU_DOMINIO/v1/wa/webhook`
- Verify token: el mismo `WHATSAPP_VERIFY_TOKEN`
- Suscribite a `messages`

## 7) Prueba
- Mandate un WhatsApp al número conectado.
- Debería aparecer una conversación en Inbox.
- Probá enviar mensaje desde el panel.

