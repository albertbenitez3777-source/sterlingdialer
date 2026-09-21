-- Test calls are deliberately separate from leads, campaigns and production metrics.
create table public.federal_one_test_calls (
  id uuid primary key,
  requested_by uuid not null references public.agents(id),
  agent_id uuid not null references public.agents(id),
  client_name text not null check (length(client_name) between 1 and 80),
  client_phone text not null check (client_phone ~ '^\+[1-9][0-9]{7,14}$'),
  agent_name text not null,
  from_number text not null,
  transfer_number text not null,
  extension text not null,
  provider_call_id text unique,
  status text not null default 'submitting',
  answered_by text,
  transferred_to text,
  transferred_at timestamptz,
  completed boolean not null default false,
  summary text,
  transcript text,
  error_message text,
  created_at timestamptz not null default now(),
  checked_at timestamptz
);
create index federal_one_test_calls_created_idx on public.federal_one_test_calls (created_at desc);
create index federal_one_test_calls_requester_idx on public.federal_one_test_calls (requested_by, created_at desc);
alter table public.federal_one_test_calls enable row level security;
revoke all on public.federal_one_test_calls from anon, authenticated;
grant all on public.federal_one_test_calls to service_role;

-- A transaction lock closes the double-click/concurrent-request race before any
-- chargeable provider request. Only the authenticated Edge handler may call this.
create function public.reserve_phone_test(p_id uuid, p_requester uuid, p_agent uuid,
  p_name text, p_phone text, p_agent_name text, p_from text, p_transfer text, p_extension text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.federal_one_test_calls; begin
  perform pg_advisory_xact_lock(hashtextextended(p_requester::text, 419));
  select * into v_row from public.federal_one_test_calls where id = p_id;
  if found then
    if v_row.requested_by <> p_requester then raise exception 'Request already exists'; end if;
    return jsonb_build_object('created', false, 'call', to_jsonb(v_row));
  end if;
  if exists (select 1 from public.federal_one_test_calls where requested_by=p_requester
    and created_at > now()-interval '15 seconds') then
    return jsonb_build_object('limited', true);
  end if;
  insert into public.federal_one_test_calls(id,requested_by,agent_id,client_name,client_phone,
    agent_name,from_number,transfer_number,extension)
  values(p_id,p_requester,p_agent,p_name,p_phone,p_agent_name,p_from,p_transfer,p_extension)
  returning * into v_row;
  return jsonb_build_object('created', true, 'call', to_jsonb(v_row));
end; $$;
revoke all on function public.reserve_phone_test(uuid,uuid,uuid,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.reserve_phone_test(uuid,uuid,uuid,text,text,text,text,text,text) to service_role;

-- Private durable mailbox; agent sessions are checked by the Edge function.
create table public.federal_one_voicemails (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id),
  provider_message_id text not null unique,
  caller_number text,
  caller_name text,
  received_at timestamptz not null default now(),
  duration_seconds integer check (duration_seconds >= 0),
  storage_path text not null,
  heard_at timestamptz
);
create index federal_one_voicemails_agent_idx on public.federal_one_voicemails(agent_id,received_at desc);
alter table public.federal_one_voicemails enable row level security;
revoke all on public.federal_one_voicemails from anon, authenticated;
grant all on public.federal_one_voicemails to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('agent-voicemail','agent-voicemail',false,15728640,array['audio/mpeg','audio/wav','audio/x-wav','audio/ogg'])
on conflict(id) do nothing;
