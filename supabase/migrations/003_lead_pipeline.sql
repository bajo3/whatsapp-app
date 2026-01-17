-- Lead pipeline, source, and AI insights

-- Enums
DO $$ BEGIN
  CREATE TYPE public.lead_stage AS ENUM ('new','contacted','visited','reserved','sold','lost');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.lead_source AS ENUM ('ig','ml','referral','web','walkin','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Conversations: stage + source + ai_meta
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS lead_stage public.lead_stage NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS lead_source public.lead_source,
  ADD COLUMN IF NOT EXISTS ai_meta jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Useful index for pipeline filtering
CREATE INDEX IF NOT EXISTS conversations_stage_idx ON public.conversations (dealership_id, lead_stage, last_message_at);
CREATE INDEX IF NOT EXISTS conversations_source_idx ON public.conversations (dealership_id, lead_source);

-- Contacts: lightweight sales fields
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS doc_id text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS lead_source public.lead_source;

