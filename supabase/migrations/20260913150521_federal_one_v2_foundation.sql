-- Federal One 2.0 foundation
-- These tables are intentionally server-only. The application uses the existing
-- verified custom session through wolf-provider; anon/authenticated roles never
-- receive direct table access.

create table if not exists public.federal_one_agent_settings (
  agent_id uuid primary key references public.agents(id) on delete cascade,
  generation text not null default '2.0' check (generation = '2.0'),
  personal_dialer_enabled boolean not null default false,
  personal_dialer_state text not null default 'stopped'
    check (personal_dialer_state in ('stopped', 'ready', 'running', 'paused', 'needs_certification')),
  camera_required boolean not null default true,
  camera_state text not null default 'disconnected'
    check (camera_state in ('disconnected', 'requesting', 'connected', 'blocked')),
  camera_verified_at timestamptz,
  mobile_companion_only boolean not null default true,
  number_certification_state text not null default 'existing_route'
    check (number_certification_state in ('existing_route', 'pending', 'testing', 'certified', 'failed')),
  updated_at timestamptz not null default now()
);

create table if not exists public.federal_one_chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_key text not null default 'team' check (room_key ~ '^[a-z0-9_-]{1,40}$'),
  sender_agent_id uuid references public.agents(id) on delete set null,
  sender_name text not null,
  message_kind text not null default 'agent'
    check (message_kind in ('agent', 'system', 'transfer', 'callback')),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists federal_one_chat_room_created_idx
  on public.federal_one_chat_messages(room_key, created_at desc);

create table if not exists public.federal_one_source_findings (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.agents(id) on delete restrict,
  contact_key text not null,
  client_name text not null,
  client_phone text,
  source_name text not null,
  source_url text not null,
  finding_type text not null default 'other'
    check (finding_type in ('phone', 'email', 'address', 'property', 'business', 'web', 'other')),
  finding_value text not null,
  match_status text not null default 'possible'
    check (match_status in ('possible', 'confirmed', 'rejected')),
  confidence smallint not null default 50 check (confidence between 0 and 100),
  reviewed_by uuid references public.agents(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists federal_one_source_contact_idx
  on public.federal_one_source_findings(contact_key, created_at desc);
create index if not exists federal_one_source_creator_idx
  on public.federal_one_source_findings(created_by, created_at desc);

create table if not exists public.federal_one_video_sessions (
  id uuid primary key default gen_random_uuid(),
  room_key text not null,
  created_by uuid not null references public.agents(id) on delete restrict,
  status text not null default 'waiting'
    check (status in ('waiting', 'active', 'ended', 'failed')),
  camera_permission text not null default 'unknown'
    check (camera_permission in ('unknown', 'granted', 'denied')),
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.federal_one_agent_settings enable row level security;
alter table public.federal_one_chat_messages enable row level security;
alter table public.federal_one_source_findings enable row level security;
alter table public.federal_one_video_sessions enable row level security;

revoke all on public.federal_one_agent_settings from anon, authenticated;
revoke all on public.federal_one_chat_messages from anon, authenticated;
revoke all on public.federal_one_source_findings from anon, authenticated;
revoke all on public.federal_one_video_sessions from anon, authenticated;

insert into public.federal_one_agent_settings (agent_id)
select id from public.agents
where status = 'active' and is_owner is false
on conflict (agent_id) do nothing;

comment on table public.federal_one_agent_settings is 'Federal One 2.0 per-agent operational controls; current phone mappings remain canonical in agents.';
comment on table public.federal_one_chat_messages is 'Persistent Federal One team and system chat, accessible only through verified server actions.';
comment on table public.federal_one_source_findings is 'Agent-reviewed SourceView findings; external discoveries remain possible until explicitly confirmed.';
comment on table public.federal_one_video_sessions is 'Metadata for consent-based Federal One Workroom sessions; no media is stored here.';
