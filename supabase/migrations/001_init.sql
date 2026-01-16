-- WhatsApp Manager (Cloud API) - Supabase schema

-- Extensions (Supabase already enables some; safe to repeat)
create extension if not exists pgcrypto;

-- Enums
create type public.user_role as enum ('admin','manager','seller');
create type public.conversation_status as enum ('open','snoozed','closed');
create type public.message_direction as enum ('in','out');
create type public.message_status as enum ('queued','sent','delivered','read','failed');
create type public.followup_status as enum ('pending','done','canceled');

-- Core: dealerships / profiles
create table if not exists public.dealerships (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  dealership_id uuid not null references public.dealerships (id) on delete restrict,
  role public.user_role not null default 'seller',
  full_name text,
  created_at timestamptz not null default now()
);

-- WhatsApp channel config per dealership
create table if not exists public.wa_channels (
  id uuid primary key default gen_random_uuid(),
  dealership_id uuid not null references public.dealerships (id) on delete cascade,
  provider text not null default 'cloud',
  phone_number_id text not null,
  waba_id text,
  display_phone text,
  verify_token text,
  created_at timestamptz not null default now(),
  unique (phone_number_id)
);

-- Contacts (clients)
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  dealership_id uuid not null references public.dealerships (id) on delete cascade,
  phone_e164 text not null,
  name text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  unique (dealership_id, phone_e164)
);

-- Conversations
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  dealership_id uuid not null references public.dealerships (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  status public.conversation_status not null default 'open',
  assigned_to uuid references public.profiles (id) on delete set null,
  last_message_at timestamptz,
  unread_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (dealership_id, contact_id)
);

-- Messages
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  dealership_id uuid not null references public.dealerships (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  direction public.message_direction not null,
  type text not null default 'text',
  text_body text,
  status public.message_status not null default 'queued',
  wa_message_id text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);
create index if not exists messages_conversation_id_idx on public.messages (conversation_id, created_at);
create unique index if not exists messages_wa_message_id_uq on public.messages (wa_message_id) where wa_message_id is not null;

-- Tags
create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  dealership_id uuid not null references public.dealerships (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (dealership_id, name)
);

create table if not exists public.conversation_tags (
  dealership_id uuid not null references public.dealerships (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (conversation_id, tag_id)
);
create index if not exists conversation_tags_conv_idx on public.conversation_tags (conversation_id);

-- Quick replies
create table if not exists public.quick_replies (
  id uuid primary key default gen_random_uuid(),
  dealership_id uuid not null references public.dealerships (id) on delete cascade,
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);

-- Templates (store metadata for convenient UI; the actual approval is in Meta)
create table if not exists public.wa_templates (
  id uuid primary key default gen_random_uuid(),
  dealership_id uuid not null references public.dealerships (id) on delete cascade,
  name text not null,
  language text not null,
  components jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (dealership_id, name)
);

-- Follow-ups (simple reminders)
create table if not exists public.followups (
  id uuid primary key default gen_random_uuid(),
  dealership_id uuid not null references public.dealerships (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  due_at timestamptz not null,
  status public.followup_status not null default 'pending',
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists followups_due_idx on public.followups (dealership_id, due_at);

-- Notes (internal)
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  dealership_id uuid not null references public.dealerships (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);

-- Helpers for RLS
create or replace function public.current_dealership_id() returns uuid
language sql stable security definer
as $$
  select p.dealership_id from public.profiles p where p.id = auth.uid();
$$;

create or replace function public.current_user_role() returns public.user_role
language sql stable security definer
as $$
  select p.role from public.profiles p where p.id = auth.uid();
$$;

-- Default setters (for client-side inserts)
create or replace function public.set_defaults() returns trigger
language plpgsql
as $$
begin
  if new.dealership_id is null then
    new.dealership_id := public.current_dealership_id();
  end if;
  if (tg_table_name in ('messages','notes')) and new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

-- Attach triggers
drop trigger if exists trg_contacts_defaults on public.contacts;
create trigger trg_contacts_defaults before insert on public.contacts
for each row execute function public.set_defaults();

drop trigger if exists trg_conversations_defaults on public.conversations;
create trigger trg_conversations_defaults before insert on public.conversations
for each row execute function public.set_defaults();

drop trigger if exists trg_messages_defaults on public.messages;
create trigger trg_messages_defaults before insert on public.messages
for each row execute function public.set_defaults();

drop trigger if exists trg_tags_defaults on public.tags;
create trigger trg_tags_defaults before insert on public.tags
for each row execute function public.set_defaults();

drop trigger if exists trg_conv_tags_defaults on public.conversation_tags;
create trigger trg_conv_tags_defaults before insert on public.conversation_tags
for each row execute function public.set_defaults();

drop trigger if exists trg_qr_defaults on public.quick_replies;
create trigger trg_qr_defaults before insert on public.quick_replies
for each row execute function public.set_defaults();

drop trigger if exists trg_templates_defaults on public.wa_templates;
create trigger trg_templates_defaults before insert on public.wa_templates
for each row execute function public.set_defaults();

drop trigger if exists trg_followups_defaults on public.followups;
create trigger trg_followups_defaults before insert on public.followups
for each row execute function public.set_defaults();

drop trigger if exists trg_notes_defaults on public.notes;
create trigger trg_notes_defaults before insert on public.notes
for each row execute function public.set_defaults();

-- RLS
alter table public.profiles enable row level security;
alter table public.dealerships enable row level security;
alter table public.wa_channels enable row level security;
alter table public.contacts enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.tags enable row level security;
alter table public.conversation_tags enable row level security;
alter table public.quick_replies enable row level security;
alter table public.wa_templates enable row level security;
alter table public.followups enable row level security;
alter table public.notes enable row level security;

-- Dealerships: users can select their own dealership record
drop policy if exists dealerships_select on public.dealerships;
create policy dealerships_select on public.dealerships
for select using (id = public.current_dealership_id());

-- Profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
for select using (dealership_id = public.current_dealership_id());

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
for insert with check (id = auth.uid());

drop policy if exists profiles_update_self_or_admin on public.profiles;
create policy profiles_update_self_or_admin on public.profiles
for update using (
  id = auth.uid()
  or public.current_user_role() in ('admin','manager')
) with check (
  dealership_id = public.current_dealership_id()
);

-- Generic helper macro (repeat pattern)
-- wa_channels
drop policy if exists wa_channels_rw on public.wa_channels;
create policy wa_channels_rw on public.wa_channels
for all using (dealership_id = public.current_dealership_id()) with check (dealership_id = public.current_dealership_id());

-- contacts
drop policy if exists contacts_rw on public.contacts;
create policy contacts_rw on public.contacts
for all using (dealership_id = public.current_dealership_id()) with check (dealership_id = public.current_dealership_id());

-- conversations
drop policy if exists conversations_rw on public.conversations;
create policy conversations_rw on public.conversations
for all using (dealership_id = public.current_dealership_id()) with check (dealership_id = public.current_dealership_id());

-- messages
drop policy if exists messages_rw on public.messages;
create policy messages_rw on public.messages
for all using (dealership_id = public.current_dealership_id()) with check (dealership_id = public.current_dealership_id());

-- tags
drop policy if exists tags_rw on public.tags;
create policy tags_rw on public.tags
for all using (dealership_id = public.current_dealership_id()) with check (dealership_id = public.current_dealership_id());

-- conversation_tags
drop policy if exists conversation_tags_rw on public.conversation_tags;
create policy conversation_tags_rw on public.conversation_tags
for all using (dealership_id = public.current_dealership_id()) with check (dealership_id = public.current_dealership_id());

-- quick_replies
drop policy if exists quick_replies_rw on public.quick_replies;
create policy quick_replies_rw on public.quick_replies
for all using (dealership_id = public.current_dealership_id()) with check (dealership_id = public.current_dealership_id());

-- wa_templates
drop policy if exists wa_templates_rw on public.wa_templates;
create policy wa_templates_rw on public.wa_templates
for all using (dealership_id = public.current_dealership_id()) with check (dealership_id = public.current_dealership_id());

-- followups
drop policy if exists followups_rw on public.followups;
create policy followups_rw on public.followups
for all using (dealership_id = public.current_dealership_id()) with check (dealership_id = public.current_dealership_id());

-- notes
drop policy if exists notes_rw on public.notes;
create policy notes_rw on public.notes
for all using (dealership_id = public.current_dealership_id()) with check (dealership_id = public.current_dealership_id());
