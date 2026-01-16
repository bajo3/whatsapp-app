-- QoL: track when the agent last opened a contact + faster followups queries

alter table public.contacts
  add column if not exists last_seen_by_agent_at timestamptz;

create index if not exists followups_status_due_idx
  on public.followups (dealership_id, status, due_at);
