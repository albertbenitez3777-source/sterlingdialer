
alter table public.campaigns add column if not exists dispatch_epoch bigint not null default 0;
create or replace function public.bump_dialer_dispatch_epoch() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
 if new.state is distinct from old.state or new.dialer_activated is distinct from old.dialer_activated then
   new.dispatch_epoch=old.dispatch_epoch+1;
 end if;
 return new;
end; $$;
revoke all on function public.bump_dialer_dispatch_epoch() from public,anon,authenticated;
drop trigger if exists dialer_dispatch_epoch_change on public.campaigns;
create trigger dialer_dispatch_epoch_change before update of state,dialer_activated on public.campaigns
for each row execute function public.bump_dialer_dispatch_epoch();

create table if not exists public.federal_one_phone_presence (
 agent_id uuid not null references public.agents(id) on delete cascade,
 instance_id uuid not null,
 session_id uuid not null references public.auth_sessions(id) on delete cascade,
 connection_state text not null check(connection_state in ('idle','connecting','ready','failed')),
 call_state text not null check(call_state in ('idle','dialing','ringing-in','answering','active','ending')),
 microphone_granted boolean not null default false,
 device_kind text not null check(device_kind in ('desktop','companion')),
 sequence bigint not null check(sequence >= 0),
 last_seen_at timestamptz not null default now(),
 primary key(agent_id,instance_id)
);
alter table public.federal_one_phone_presence enable row level security;
revoke all on public.federal_one_phone_presence from public,anon,authenticated;
grant select,insert,update,delete on public.federal_one_phone_presence to service_role;
create policy phone_presence_service_only on public.federal_one_phone_presence for all to service_role using(true) with check(true);
create or replace function public.record_phone_presence(
 p_agent_id uuid,p_instance_id uuid,p_session_id uuid,p_connection_state text,
 p_call_state text,p_microphone_granted boolean,p_device_kind text,p_sequence bigint
) returns boolean language plpgsql security invoker set search_path=public as $$
declare v_changed integer;
begin
 if not exists(select 1 from public.auth_sessions s where s.id=p_session_id and s.agent_id=p_agent_id and s.invalidated_at is null and s.expires_at>now()) then
   raise exception 'Valid session required';
 end if;
 insert into public.federal_one_phone_presence as p(agent_id,instance_id,session_id,connection_state,call_state,microphone_granted,device_kind,sequence,last_seen_at)
 values(p_agent_id,p_instance_id,p_session_id,p_connection_state,p_call_state,p_microphone_granted,p_device_kind,p_sequence,now())
 on conflict(agent_id,instance_id) do update set session_id=excluded.session_id,connection_state=excluded.connection_state,
 call_state=excluded.call_state,microphone_granted=excluded.microphone_granted,device_kind=excluded.device_kind,
 sequence=excluded.sequence,last_seen_at=now()
 where p.session_id=excluded.session_id and excluded.sequence>p.sequence;
 get diagnostics v_changed=row_count;
 return v_changed>0;
end; $$;
revoke all on function public.record_phone_presence(uuid,uuid,uuid,text,text,boolean,text,bigint) from public,anon,authenticated;
grant execute on function public.record_phone_presence(uuid,uuid,uuid,text,text,boolean,text,bigint) to service_role;
create or replace function public.agent_phone_ready(p_agent_id uuid)
returns boolean language sql stable security invoker set search_path=public as $$
with live as (
 select p.* from public.federal_one_phone_presence p
 join public.auth_sessions s on s.id=p.session_id and s.agent_id=p.agent_id
 where p.agent_id=p_agent_id and p.device_kind='desktop'
 and p.last_seen_at>=now()-interval '75 seconds' and p.last_seen_at<=now()
 and s.invalidated_at is null and s.expires_at>now()
)
select exists(select 1 from live where connection_state='ready' and microphone_granted and call_state='idle')
 and not exists(select 1 from live where call_state in ('dialing','ringing-in','answering','active','ending'));
$$;
revoke all on function public.agent_phone_ready(uuid) from public,anon,authenticated;
grant execute on function public.agent_phone_ready(uuid) to service_role;

CREATE OR REPLACE FUNCTION public.count_available_agents()
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
SELECT count(*)::integer
FROM public.agents a
WHERE a.status = 'active'
AND a.is_owner = false
AND a.active_for_dialer = true
AND a.available_for_transfer = true
AND public.agent_phone_ready(a.id)
AND a.transfer_certified = true
AND a.bland_number IS NOT NULL AND a.bland_number <> ''
AND a.talkroute_number IS NOT NULL AND a.talkroute_number <> '';
$function$;

CREATE OR REPLACE FUNCTION public.dialer_next_batch()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_campaign        record;
v_remaining       integer;
v_calls_placed    integer;
v_results         jsonb[] := ARRAY[]::jsonb[];
v_lead            record;
v_call_id         uuid;
v_agent           record;
v_agent_remaining integer;
v_active          integer;
v_phone_already_called boolean;
v_global_active   integer;
v_global_remaining integer;
v_recent_hour integer;
v_recent_minute integer;
v_james_id        uuid := 'c242abef-c01e-490b-bab6-859cd89bd08a';
BEGIN
IF NOT pg_try_advisory_xact_lock(217, 1) THEN
RETURN jsonb_build_object('success', true, 'calls', jsonb_build_array(), 'skipped', 'batch_locked');
END IF;

SELECT * INTO v_campaign FROM public.campaigns ORDER BY created_at DESC LIMIT 1;

IF v_campaign.state <> 'running' THEN
RETURN jsonb_build_object('success', false, 'error', 'Campaign is not running');
END IF;

-- 3-minute placeholder cleanup
DELETE FROM public.calls
WHERE call_direction = 'outbound'
AND (provider_call_id IS NULL OR provider_call_id = '')
AND created_at < now() - interval '3 minutes';

-- Call-limit cap
SELECT count(*) INTO v_calls_placed
FROM public.calls
WHERE created_at >= v_campaign.started_at
AND call_direction = 'outbound'
AND provider_call_id IS NOT NULL AND provider_call_id <> '';

v_remaining := v_campaign.provider_call_limit - v_calls_placed;
IF v_remaining <= 0 THEN
RETURN jsonb_build_object('success', true, 'calls_to_dial', 0, 'message', 'Call limit reached');
END IF;

SELECT count(*)::integer,
count(*) FILTER (WHERE created_at >= now()-interval '1 minute')::integer
INTO v_recent_hour, v_recent_minute
FROM public.calls
WHERE call_direction='outbound' AND created_at >= now()-interval '1 hour';

v_remaining := LEAST(v_remaining,
public.dialer_rate_allowance(v_campaign.hourly_call_target,v_recent_hour,v_recent_minute));
IF v_remaining <= 0 THEN
RETURN jsonb_build_object('success',true,'calls',jsonb_build_array(),
'calls_to_dial',0,'skipped','hourly_pacing','hourly_target',v_campaign.hourly_call_target);
END IF;

-- Global concurrency cap (hard ceiling 21)
SELECT count(*) INTO v_global_active
FROM public.calls
WHERE call_direction = 'outbound'
AND queue = 'pending'
AND is_completed = false;

v_global_remaining := LEAST(
GREATEST(LEAST(v_campaign.concurrency, 21) - v_global_active, 0),
v_remaining
);

-- ────────────────────────────────────────────────────────
-- RETRY MODE: pull from retry_leads instead of leads
-- ────────────────────────────────────────────────────────
IF v_campaign.campaign_type = 'retry' THEN
-- Reset stuck in_progress retry_leads
UPDATE public.retry_leads
SET status = 'new'
WHERE status = 'in_progress'
AND NOT EXISTS (
SELECT 1 FROM public.calls c
WHERE c.consumer_phone = retry_leads.phone_normalized
AND c.call_direction = 'outbound'
AND c.provider_call_id IS NOT NULL AND c.provider_call_id <> ''
AND c.created_at >= v_campaign.started_at
)
AND NOT EXISTS (
SELECT 1 FROM public.calls p
WHERE p.consumer_phone = retry_leads.phone_normalized
AND p.call_direction = 'outbound'
AND p.created_at >= now() - interval '3 minutes'
);

FOR v_agent IN
SELECT * FROM public.agents a
WHERE a.active_for_dialer = true
AND a.status = 'active'
AND a.is_owner = false
AND a.available_for_transfer = true
AND public.agent_phone_ready(a.id)
AND a.transfer_certified = true
AND a.bland_number IS NOT NULL AND a.bland_number <> ''
AND a.talkroute_number IS NOT NULL AND a.talkroute_number <> ''
ORDER BY (
SELECT count(*) FROM public.calls c
WHERE c.agent_id = a.id AND c.created_at >= v_campaign.started_at
), a.created_at
LOOP
IF v_global_remaining <= 0 OR v_remaining <= 0 THEN EXIT; END IF;

SELECT count(*) INTO v_active
FROM public.calls
WHERE agent_id = v_agent.id AND queue = 'pending' AND is_completed = false;

v_agent_remaining := LEAST(
GREATEST(LEAST(COALESCE(v_agent.dialer_concurrency,3),7) - v_active, 0),
v_global_remaining, v_remaining
);
IF v_agent_remaining <= 0 THEN CONTINUE; END IF;

FOR v_lead IN
SELECT rl.id, rl.phone_normalized, rl.consumer_name, rl.address,
rl.income_range, rl.home_value, rl.property_information, rl.custom_fields
FROM public.retry_leads rl
WHERE rl.status = 'new'
AND rl.exclusion_reason IS NULL
AND NOT EXISTS (SELECT 1 FROM public.calls blocked WHERE public.normalize_phone(blocked.consumer_phone)=public.normalize_phone(rl.phone_normalized) AND (blocked.is_dnc OR blocked.is_wrong_number))
AND NOT EXISTS (
SELECT 1 FROM public.calls c
WHERE c.consumer_phone = rl.phone_normalized
AND c.call_direction = 'outbound'
AND c.provider_call_id IS NOT NULL AND c.provider_call_id <> ''
AND c.created_at >= v_campaign.started_at
)
ORDER BY rl.last_human_at DESC NULLS LAST
FOR UPDATE OF rl SKIP LOCKED
LIMIT v_agent_remaining
LOOP
UPDATE public.retry_leads SET status = 'in_progress', dialed_at = now() WHERE id = v_lead.id;

BEGIN
INSERT INTO public.calls (
lead_id, agent_id, provider, queue, call_direction,
consumer_name, consumer_phone, consumer_address,
consumer_home_value, consumer_income_range, consumer_property_info,
consumer_custom_fields
) VALUES (
NULL, v_agent.id, 'bland.ai', 'pending', 'outbound',
v_lead.consumer_name, v_lead.phone_normalized, v_lead.address,
v_lead.home_value, v_lead.income_range, v_lead.property_information,
COALESCE(v_lead.custom_fields, '{}'::jsonb)
)
RETURNING id INTO v_call_id;

v_results := array_append(v_results, jsonb_build_object(
'call_id', v_call_id, 'retry_lead_id', v_lead.id,
'phone', v_lead.phone_normalized, 'name', v_lead.consumer_name,
'agent_id', v_agent.id, 'agent_name', v_agent.full_name,
'bland_number', v_agent.bland_number, 'bland_phone_id', v_agent.bland_phone_id,
'bland_voice_id', v_agent.bland_voice_id, 'talkroute_number', v_agent.talkroute_number
));

v_remaining := v_remaining - 1;
v_global_remaining := v_global_remaining - 1;
EXCEPTION WHEN unique_violation THEN
UPDATE public.retry_leads SET status = 'closed' WHERE id = v_lead.id;
END;
END LOOP;
END LOOP;

RETURN jsonb_build_object(
'success', true,
'calls_to_dial', jsonb_array_length(to_jsonb(v_results)),
'calls', to_jsonb(v_results),
'mode', 'retry'
);
END IF;

-- ────────────────────────────────────────────────────────
-- STANDARD MODE with AGENT-LEAD ROUTING
-- James Spencer gets email_batch_20 leads only.
-- All other agents get non-email leads only.
-- ────────────────────────────────────────────────────────

-- Reset stuck leads
UPDATE public.leads
SET status = 'new'
WHERE status = 'in_progress'
AND NOT EXISTS (
SELECT 1 FROM public.calls c
WHERE c.lead_id = leads.id AND c.call_direction = 'outbound'
AND c.provider_call_id IS NOT NULL AND c.provider_call_id <> ''
)
AND NOT EXISTS (
SELECT 1 FROM public.calls p
WHERE p.lead_id = leads.id AND p.call_direction = 'outbound'
AND p.created_at >= now() - interval '3 minutes'
);

-- Close leads already dialed (but NOT force_redial leads)
UPDATE public.leads SET status = 'closed'
WHERE status IN ('new','in_progress')
AND telephone_normalized <> ''
AND force_redial IS NOT TRUE
AND EXISTS (
SELECT 1 FROM public.calls c
WHERE c.consumer_phone = leads.telephone_normalized
AND c.call_direction = 'outbound'
AND c.provider_call_id IS NOT NULL AND c.provider_call_id <> ''
);

FOR v_agent IN
SELECT * FROM public.agents a
WHERE a.active_for_dialer = true
AND a.status = 'active'
AND a.is_owner = false
AND a.available_for_transfer = true
AND public.agent_phone_ready(a.id)
AND a.transfer_certified = true
AND a.bland_number IS NOT NULL AND a.bland_number <> ''
AND a.talkroute_number IS NOT NULL AND a.talkroute_number <> ''
ORDER BY (
SELECT count(*) FROM public.calls c
WHERE c.agent_id = a.id AND c.created_at >= v_campaign.started_at
), a.created_at
LOOP
IF v_global_remaining <= 0 OR v_remaining <= 0 THEN EXIT; END IF;

SELECT count(*) INTO v_active
FROM public.calls
WHERE agent_id = v_agent.id AND queue = 'pending' AND is_completed = false;

v_agent_remaining := LEAST(
GREATEST(LEAST(COALESCE(v_agent.dialer_concurrency,3),7) - v_active, 0),
v_global_remaining, v_remaining
);
IF v_agent_remaining <= 0 THEN CONTINUE; END IF;

FOR v_lead IN
SELECT l.id, l.name, l.telephone_original, l.telephone_normalized,
l.address, l.income_range, l.home_value, l.property_information,
l.notes, l.source, l.custom_fields, l.retry_count, l.next_eligible_at,
l.force_redial
FROM public.leads l
WHERE l.status = 'new'
AND NOT EXISTS (SELECT 1 FROM public.calls blocked WHERE public.normalize_phone(blocked.consumer_phone)=public.normalize_phone(l.telephone_normalized) AND (blocked.is_dnc OR blocked.is_wrong_number))
AND l.telephone_normalized <> ''
AND (l.next_eligible_at IS NULL OR l.next_eligible_at <= now())
-- AGENT-LEAD ROUTING: James gets email leads, others get non-email leads
AND CASE
WHEN v_agent.id = v_james_id THEN l.source = 'email_batch_20'
ELSE l.source <> 'email_batch_20'
END
AND (
l.force_redial = true
OR NOT EXISTS (
SELECT 1 FROM public.calls c
WHERE c.consumer_phone = l.telephone_normalized
AND c.call_direction = 'outbound'
AND c.provider_call_id IS NOT NULL AND c.provider_call_id <> ''
)
)
ORDER BY l.created_at ASC
FOR UPDATE OF l SKIP LOCKED
LIMIT v_agent_remaining
LOOP
IF v_lead.force_redial IS NOT TRUE THEN
SELECT EXISTS(
SELECT 1 FROM public.calls c
WHERE c.consumer_phone = v_lead.telephone_normalized
AND c.call_direction = 'outbound'
AND c.provider_call_id IS NOT NULL AND c.provider_call_id <> ''
) INTO v_phone_already_called;

IF v_phone_already_called THEN
UPDATE public.leads SET status = 'closed' WHERE id = v_lead.id;
CONTINUE;
END IF;
END IF;

UPDATE public.leads SET status = 'in_progress', force_redial = false WHERE id = v_lead.id;

BEGIN
INSERT INTO public.calls (
lead_id, agent_id, provider, queue, call_direction,
consumer_name, consumer_phone, consumer_address,
consumer_home_value, consumer_income_range, consumer_property_info,
consumer_custom_fields
) VALUES (
v_lead.id, v_agent.id, 'bland.ai', 'pending', 'outbound',
v_lead.name, v_lead.telephone_normalized, v_lead.address,
v_lead.home_value, v_lead.income_range, v_lead.property_information,
COALESCE(v_lead.custom_fields, '{}'::jsonb)
)
RETURNING id INTO v_call_id;

v_results := array_append(v_results, jsonb_build_object(
'call_id', v_call_id, 'lead_id', v_lead.id, 'force_redial', coalesce(v_lead.force_redial,false),
'phone', v_lead.telephone_normalized, 'name', v_lead.name,
'agent_id', v_agent.id, 'agent_name', v_agent.full_name,
'bland_number', v_agent.bland_number, 'bland_phone_id', v_agent.bland_phone_id,
'bland_voice_id', v_agent.bland_voice_id, 'talkroute_number', v_agent.talkroute_number,
'agent_direct_number', v_agent.agent_direct_number
));

v_remaining := v_remaining - 1;
v_global_remaining := v_global_remaining - 1;
EXCEPTION WHEN unique_violation THEN
UPDATE public.leads SET status = 'closed' WHERE id = v_lead.id;
END;
END LOOP;
END LOOP;

RETURN jsonb_build_object(
'success', true,
'calls_to_dial', jsonb_array_length(to_jsonb(v_results)),
'calls', to_jsonb(v_results)
);
END;
$function$;

CREATE OR REPLACE FUNCTION public.campaign_start(p_concurrency integer DEFAULT 3, p_call_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_campaign record;
v_selected_count integer;
v_blocking text := '';
v_eligible_leads integer;
v_cleaned_count integer;
BEGIN
IF public.count_available_agents() = 0 THEN
 RETURN jsonb_build_object('success',false,'error','No desktop phones ready','blocking_reason','An agent must connect Zadarma, allow the microphone, and select Available.');
END IF;
IF p_concurrency NOT IN (3,6,9,12) OR p_concurrency IS NULL OR p_call_limit IS NULL OR p_call_limit<=0 THEN
 RETURN jsonb_build_object('success',false,'error','Choose speed 1x-4x and a positive call limit.');
END IF;
SELECT * INTO v_campaign FROM public.campaigns ORDER BY created_at DESC LIMIT 1;

-- Provider-accepted calls remain pending until a webhook or backfill confirms
-- completion. Preserve the legacy response field without inventing outcomes.
v_cleaned_count := 0;

UPDATE public.leads
SET status = 'new'
WHERE status = 'in_progress'
AND id IN (
SELECT DISTINCT c.lead_id FROM public.calls c
WHERE c.queue <> 'pending' AND c.lead_id IS NOT NULL
);

SELECT count(*) INTO v_selected_count FROM public.agents a
WHERE a.active_for_dialer = true
AND a.status = 'active'
AND a.is_owner = false
AND a.transfer_certified = true
AND a.bland_number IS NOT NULL AND a.bland_number <> ''
AND a.talkroute_number IS NOT NULL AND a.talkroute_number <> '';

SELECT count(*) INTO v_eligible_leads FROM public.leads WHERE status = 'new';

IF v_selected_count = 0 THEN v_blocking := v_blocking || 'No agents available (must be selected, active and transfer-certified with valid phone numbers). '; END IF;
IF v_eligible_leads = 0 THEN v_blocking := v_blocking || 'No leads uploaded. '; END IF;
IF v_campaign.state = 'running' THEN v_blocking := v_blocking || 'Campaign already running. '; END IF;

IF v_blocking <> '' THEN
UPDATE public.campaigns SET blocking_reason = v_blocking, updated_at = now() WHERE id = v_campaign.id;
RETURN jsonb_build_object('success', false, 'error', 'Campaign cannot start', 'blocking_reason', v_blocking);
END IF;

UPDATE public.campaigns
SET state = 'running', dialer_status = 'dialing', dialer_activated = true, concurrency = p_concurrency,
provider_call_limit = p_call_limit, started_at = now(), blocking_reason = '', updated_at = now()
WHERE id = v_campaign.id;

INSERT INTO public.campaign_events (campaign_id, event_type, event_data)
VALUES (v_campaign.id, 'campaign_start', jsonb_build_object('concurrency', p_concurrency, 'call_limit', p_call_limit, 'stale_cleaned', v_cleaned_count));

RETURN jsonb_build_object('success', true, 'message', 'Campaign started', 'stale_cleaned', v_cleaned_count);
END;
$function$;

CREATE OR REPLACE FUNCTION public.campaign_resume()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
IF public.count_available_agents() = 0 THEN
 RETURN jsonb_build_object('success',false,'error','No desktop phones ready','blocking_reason','Connect an agent desktop phone before resuming.');
END IF;
SELECT id INTO v_id FROM public.campaigns ORDER BY created_at DESC LIMIT 1;
UPDATE public.campaigns SET state = 'running', dialer_status = 'dialing', dialer_activated = true, updated_at = now() WHERE id = v_id;
INSERT INTO public.campaign_events (campaign_id, event_type, event_data) VALUES (v_id, 'campaign_resume', '{}'::jsonb);
RETURN jsonb_build_object('success', true, 'state', 'running');
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_dialer_ready_agents()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_result jsonb;
BEGIN
SELECT jsonb_agg(
jsonb_build_object(
'id', a.id,
'full_name', a.full_name,
'bland_number', a.bland_number,
'bland_phone_id', a.bland_phone_id,
'bland_voice_id', a.bland_voice_id
)
)
INTO v_result
FROM public.agents a
WHERE a.active_for_dialer = true
AND a.available_for_transfer = true
AND public.agent_phone_ready(a.id)
AND a.bland_number <> ''
AND a.bland_phone_id <> ''
AND a.bland_number_owned_active = true
AND a.bland_voice_id <> ''
AND a.talkroute_number <> ''
AND a.talkroute_verified = true
AND a.transfer_certified = true
AND a.status = 'active';

RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;


create or replace function public.dialer_dispatch_allowed(p_campaign_id uuid,p_started_at timestamptz,p_agent_id uuid,p_epoch bigint)
returns boolean language sql stable security invoker set search_path=public as $$
 select exists (
 select 1 from public.campaigns c join public.agents a on a.id=p_agent_id
 where c.id=p_campaign_id and c.id=(select id from public.campaigns order by created_at desc limit 1)
 and c.dispatch_epoch=p_epoch and c.started_at is not distinct from p_started_at and c.state='running' and c.dialer_activated
 and a.status='active' and not a.is_owner and a.active_for_dialer and a.available_for_transfer
 and a.transfer_certified and public.agent_phone_ready(a.id)
 and (select count(*) from public.calls x where x.call_direction='outbound' and x.queue='pending'
      and not x.is_completed and nullif(x.provider_call_id,'') is not null)<least(c.concurrency,12)
 and (select count(*) from public.calls x where x.agent_id=a.id and x.queue='pending'
      and not x.is_completed and nullif(x.provider_call_id,'') is not null)<least(coalesce(a.dialer_concurrency,3),7)
 );
$$;
revoke all on function public.dialer_dispatch_allowed(uuid,timestamptz,uuid,bigint) from public,anon,authenticated;
grant execute on function public.dialer_dispatch_allowed(uuid,timestamptz,uuid,bigint) to service_role;
