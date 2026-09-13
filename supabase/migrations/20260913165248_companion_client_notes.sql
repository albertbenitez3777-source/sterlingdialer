create table if not exists public.federal_one_client_notes (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete restrict,
  contact_key text not null,
  client_name text not null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists federal_one_client_notes_contact_idx
  on public.federal_one_client_notes(contact_key, created_at desc);
create index if not exists federal_one_client_notes_agent_idx
  on public.federal_one_client_notes(agent_id, created_at desc);
alter table public.federal_one_client_notes enable row level security;
revoke all on public.federal_one_client_notes from anon, authenticated;
