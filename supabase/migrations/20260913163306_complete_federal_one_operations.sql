-- Federal One 2.0 complete operations foundation.
-- All tables remain server-only and are accessed through a verified custom session.

alter table public.campaigns add column if not exists daily_call_target integer not null default 2000;
alter table public.campaigns drop constraint if exists campaigns_hourly_call_target_check;
alter table public.campaigns drop constraint if exists campaigns_daily_call_target_check;

update public.campaigns
set hourly_call_target = least(greatest(hourly_call_target, 1), 400),
    daily_call_target = least(greatest(daily_call_target, 1), 2000)
where hourly_call_target > 400 or daily_call_target > 2000;

alter table public.campaigns add constraint campaigns_hourly_call_target_check
  check (hourly_call_target between 1 and 400);
alter table public.campaigns add constraint campaigns_daily_call_target_check
  check (daily_call_target between 1 and 2000);

create table if not exists public.federal_one_route_audits (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  bland_number text not null,
  talkroute_number text not null,
  webhook_url text not null,
  expected_fingerprint text not null,
  provider_fingerprint text,
  status text not null default 'pending'
    check (status in ('pending','configured','verified','drifted','failed')),
  checks jsonb not null default '{}'::jsonb,
  error_message text,
  configured_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists federal_one_route_agent_created_idx
  on public.federal_one_route_audits(agent_id, created_at desc);

create table if not exists public.federal_one_research_sessions (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.agents(id) on delete restrict,
  contact_key text not null,
  client_name text not null,
  client_phone text,
  client_email text,
  client_address text,
  status text not null default 'ready'
    check (status in ('ready','opened','reviewing','complete','failed')),
  source_count integer not null default 0,
  sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists federal_one_research_contact_created_idx
  on public.federal_one_research_sessions(contact_key, created_at desc);

create table if not exists public.federal_one_direct_calls (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete restrict,
  contact_key text not null,
  client_name text not null,
  client_phone text not null,
  route text not null default 'talkroute',
  outcome text not null default 'opened'
    check (outcome in ('opened','answered','no_answer','voicemail','wrong_number','callback','completed')),
  opened_at timestamptz not null default now(),
  completed_at timestamptz,
  notes text
);
create index if not exists federal_one_direct_calls_agent_idx
  on public.federal_one_direct_calls(agent_id, opened_at desc);

create table if not exists public.federal_one_active_clients (
  agent_id uuid primary key references public.agents(id) on delete cascade,
  contact_key text not null,
  client_name text not null,
  client_phone text,
  client_snapshot jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.federal_one_device_heartbeats (
  agent_id uuid not null references public.agents(id) on delete cascade,
  device_key text not null,
  device_kind text not null check (device_kind in ('desktop','phone','tablet')),
  connection_state text not null default 'online' check (connection_state in ('online','away','offline')),
  last_seen_at timestamptz not null default now(),
  primary key (agent_id, device_key)
);
create index if not exists federal_one_heartbeat_seen_idx
  on public.federal_one_device_heartbeats(last_seen_at desc);

alter table public.federal_one_route_audits enable row level security;
alter table public.federal_one_research_sessions enable row level security;
alter table public.federal_one_direct_calls enable row level security;
alter table public.federal_one_active_clients enable row level security;
alter table public.federal_one_device_heartbeats enable row level security;

revoke all on public.federal_one_route_audits from anon, authenticated;
revoke all on public.federal_one_research_sessions from anon, authenticated;
revoke all on public.federal_one_direct_calls from anon, authenticated;
revoke all on public.federal_one_active_clients from anon, authenticated;
revoke all on public.federal_one_device_heartbeats from anon, authenticated;

-- Foreign-key indexes reported by the database advisor.
create index if not exists agent_inbox_call_id_idx on public.agent_inbox(call_id);
create index if not exists agent_inbox_lead_id_idx on public.agent_inbox(lead_id);
create index if not exists audit_logs_actor_id_idx on public.audit_logs(actor_id);
create index if not exists calls_lead_id_idx on public.calls(lead_id);
create index if not exists campaign_events_campaign_id_idx on public.campaign_events(campaign_id);
create index if not exists leads_assigned_agent_id_idx on public.leads(assigned_agent_id);
create index if not exists retry_leads_previous_agent_id_idx on public.retry_leads(previous_agent_id);
create index if not exists saved_transfers_call_id_idx on public.saved_transfers(call_id);
create index if not exists transfer_alerts_lead_id_idx on public.transfer_alerts(lead_id);

comment on table public.federal_one_route_audits is 'Immutable evidence for per-agent Bland inbound to Talkroute routing and drift checks.';
comment on table public.federal_one_research_sessions is 'One-click SourceView launch plans; no CAPTCHA bypass or prohibited scraping.';
comment on table public.federal_one_active_clients is 'Current client pointer shared between an agent desktop and phone companion.';
