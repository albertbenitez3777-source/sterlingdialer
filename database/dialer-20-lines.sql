-- Increase the global dialer ceiling from 12 to 20.
DO $guard$
BEGIN
 IF md5(pg_get_functiondef('public.campaign_start(integer,integer)'::regprocedure)) NOT IN ('c7f516a1dde1e9a24325d09dae5fae6a','eef1a332b1fe390ca93d62544c688c87') THEN
  RAISE EXCEPTION 'Definition changed since review: campaign_start';
 END IF;
 IF md5(pg_get_functiondef('public.dialer_dispatch_allowed(uuid,timestamp with time zone,uuid,bigint)'::regprocedure)) NOT IN ('9d5b4d96f518b324e2a32e2f6055561f','df2da722c537db8866385e66d3e6fdc2') THEN
  RAISE EXCEPTION 'Definition changed since review: dialer_dispatch_allowed';
 END IF;
 IF md5(pg_get_functiondef('public.dialer_next_batch()'::regprocedure)) NOT IN ('e42dcde141df0cbac692179136648c77','3fde8f4b23ea8502e0e823587809cf3e') THEN
  RAISE EXCEPTION 'Definition changed since review: dialer_next_batch';
 END IF;
 IF md5(pg_get_functiondef('public.dialer_rate_allowance(integer,integer,integer,integer)'::regprocedure)) NOT IN ('65f9f535da37dc6cce32a3e7f5ae68e6','e228bc29e75117bb96ff63eb4224a86c') THEN
  RAISE EXCEPTION 'Definition changed since review: dialer_rate_allowance';
 END IF;
 IF md5(pg_get_functiondef('public.get_operations_overview(uuid,text)'::regprocedure)) NOT IN ('91d3bc0513853c7908d066315d264bc1','85b7f9fd5af7f9c8165c63f384c5880f') THEN
  RAISE EXCEPTION 'Definition changed since review: get_operations_overview';
 END IF;
END;
$guard$;
-- Preserve seven lines per agent, run/hour/day caps, DNC exclusions and routing.
-- Captured from production on 2026-09-29; no campaign start/stop is performed.

CREATE OR REPLACE FUNCTION public.campaign_start(p_concurrency integer DEFAULT 3, p_call_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
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
 RETURN jsonb_build_object('success',false,'error','No verified agent routes selected','blocking_reason','Select an active agent with a verified Bland number and Zadarma destination. Desktop connection is not required.');
END IF;
IF p_concurrency NOT BETWEEN 1 AND 20 OR p_concurrency IS NULL OR p_call_limit IS NULL OR p_call_limit<=0 THEN
 RETURN jsonb_build_object('success',false,'error','Choose 1-20 simultaneous lines and a positive call limit.');
END IF;
SELECT * INTO v_campaign FROM public.campaigns ORDER BY created_at DESC LIMIT 1 FOR UPDATE;

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
offline_voicemail_test_until = NULL, offline_voicemail_test_agents = '{}'::uuid[], provider_call_limit = p_call_limit, started_at = now(), blocking_reason = '', updated_at = now()
WHERE id = v_campaign.id;

INSERT INTO public.campaign_events (campaign_id, event_type, event_data)
VALUES (v_campaign.id, 'campaign_start', jsonb_build_object('concurrency', p_concurrency, 'call_limit', p_call_limit, 'stale_cleaned', v_cleaned_count));

RETURN jsonb_build_object('success', true, 'message', 'Campaign started', 'stale_cleaned', v_cleaned_count);
END;
$function$;

CREATE OR REPLACE FUNCTION public.dialer_dispatch_allowed(p_campaign_id uuid, p_started_at timestamp with time zone, p_agent_id uuid, p_epoch bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
 select exists (
 select 1 from public.campaigns c join public.agents a on a.id=p_agent_id
 where c.id=p_campaign_id and c.id=(select id from public.campaigns order by created_at desc limit 1)
 and (select count(*) from public.calls cap where cap.call_direction='outbound' and cap.created_at>=c.started_at and nullif(cap.provider_call_id,'') is not null)<c.provider_call_limit
 and c.dispatch_epoch=p_epoch and c.started_at is not distinct from p_started_at and c.state='running' and c.dialer_activated
 and a.status='active' and not a.is_owner and a.active_for_dialer 
 and a.transfer_certified and public.campaign_agent_can_receive(a.id,c.id)
 and (select count(*) from public.calls x where x.call_direction='outbound' and x.queue='pending'
      and not x.is_completed and nullif(x.provider_call_id,'') is not null)<least(c.concurrency,20)
 and (select count(*) from public.calls x where x.agent_id=a.id and x.queue='pending'
      and not x.is_completed and nullif(x.provider_call_id,'') is not null)<least(coalesce(a.dialer_concurrency,3),7)
 );
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
v_agent_caps jsonb;
v_agent_used integer;
BEGIN
IF NOT pg_try_advisory_xact_lock(217, 1) THEN
RETURN jsonb_build_object('success', true, 'calls', jsonb_build_array(), 'skipped', 'batch_locked');
END IF;

SELECT * INTO v_campaign FROM public.campaigns ORDER BY created_at DESC LIMIT 1;

-- Optional per-agent caps apply only to the exact run that requested them.
SELECT e.event_data->'agent_limits' INTO v_agent_caps
FROM public.campaign_events e
WHERE e.campaign_id=v_campaign.id AND e.event_type='agent_attempt_limits'
AND (e.event_data->>'run_started_at')::timestamptz=v_campaign.started_at
ORDER BY e.created_at DESC LIMIT 1;

IF v_campaign.state <> 'running' THEN
RETURN jsonb_build_object('success', false, 'error', 'Campaign is not running');
END IF;

-- 3-minute placeholder cleanup
DELETE FROM public.calls
WHERE call_direction = 'outbound'
AND (provider_call_id IS NULL OR provider_call_id = '')
AND queue='pending' AND NOT is_completed
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
public.dialer_rate_allowance(v_campaign.hourly_call_target,v_recent_hour,v_recent_minute,v_campaign.concurrency));
IF v_remaining <= 0 THEN
RETURN jsonb_build_object('success',true,'calls',jsonb_build_array(),
'calls_to_dial',0,'skipped','hourly_pacing','hourly_target',v_campaign.hourly_call_target);
END IF;

-- Global concurrency cap (hard ceiling 20)
SELECT count(*) INTO v_global_active
FROM public.calls
WHERE call_direction = 'outbound'
AND queue = 'pending'
AND is_completed = false;

v_global_remaining := LEAST(
GREATEST(LEAST(v_campaign.concurrency, 20) - v_global_active, 0),
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

AND public.campaign_agent_can_receive(a.id,v_campaign.id)
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
IF v_agent_caps IS NOT NULL THEN
SELECT count(*) INTO v_agent_used FROM public.calls c
WHERE c.agent_id=v_agent.id AND c.call_direction='outbound'
AND c.created_at>=v_campaign.started_at
AND (coalesce(c.provider_call_id,'')<>'' OR (c.queue='pending' AND NOT c.is_completed));
v_agent_remaining := LEAST(v_agent_remaining,
GREATEST(COALESCE((v_agent_caps->>v_agent.id::text)::integer,0)-v_agent_used,0));
END IF;
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
-- Eligible leads are distributed fairly across selected agents.
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

AND public.campaign_agent_can_receive(a.id,v_campaign.id)
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
IF v_agent_caps IS NOT NULL THEN
SELECT count(*) INTO v_agent_used FROM public.calls c
WHERE c.agent_id=v_agent.id AND c.call_direction='outbound'
AND c.created_at>=v_campaign.started_at
AND (coalesce(c.provider_call_id,'')<>'' OR (c.queue='pending' AND NOT c.is_completed));
v_agent_remaining := LEAST(v_agent_remaining,
GREATEST(COALESCE((v_agent_caps->>v_agent.id::text)::integer,0)-v_agent_used,0));
END IF;
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
-- All active agents share the eligible pool; preserve DNC, wrong-number,
-- retry-date and previously-dialed exclusions below.
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

CREATE OR REPLACE FUNCTION public.dialer_rate_allowance(p_target integer, p_recent_hour integer, p_recent_minute integer, p_lines integer)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
 SELECT greatest(0,least(
  greatest(coalesce(p_target,400),1)-greatest(coalesce(p_recent_hour,0),0),
  greatest(ceil(greatest(coalesce(p_target,400),1)/60.0)::integer,least(greatest(coalesce(p_lines,1),1),20))-greatest(coalesce(p_recent_minute,0),0)
 ));
$function$;

CREATE OR REPLACE FUNCTION public.get_operations_overview(p_agent_id uuid DEFAULT NULL::uuid, p_window text DEFAULT 'today'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE v_since timestamptz; v_result jsonb;
BEGIN
 IF p_window IS NULL OR p_window NOT IN ('today','week','all') THEN RAISE EXCEPTION 'Invalid time range'; END IF;
 v_since:=CASE p_window WHEN 'today' THEN date_trunc('day',now() AT TIME ZONE 'America/Costa_Rica') AT TIME ZONE 'America/Costa_Rica'
 WHEN 'week' THEN date_trunc('week',now() AT TIME ZONE 'America/Costa_Rica') AT TIME ZONE 'America/Costa_Rica' ELSE '-infinity'::timestamptz END;
 WITH campaign AS MATERIALIZED (SELECT * FROM campaigns ORDER BY created_at DESC LIMIT 1),
 scoped AS MATERIALIZED (
  SELECT c.id,c.agent_id,c.created_at,c.is_live_human,c.transfer_requested_at,c.queue,
  c.is_completed,c.talkroute_leg_created,c.bridge_confirmed,c.transfer_state,c.duration_seconds
  FROM calls c WHERE c.created_at>=v_since AND c.call_direction='outbound'
  AND nullif(c.provider_call_id,'') IS NOT NULL AND(p_agent_id IS NULL OR c.agent_id=p_agent_id)
 ), native AS MATERIALIZED (
  SELECT * FROM federal_one_zadarma_calls WHERE started_at>=v_since AND(p_agent_id IS NULL OR agent_id=p_agent_id)
 ), voicemail AS MATERIALIZED (
  SELECT * FROM federal_one_voicemails WHERE nullif(storage_path,'') IS NOT NULL AND(p_agent_id IS NULL OR agent_id=p_agent_id)
 ), tracked AS MATERIALIZED (
  SELECT agent_id,provider_call_id,created_at FROM calls WHERE call_direction='outbound' AND queue='pending' AND NOT is_completed
 ), eligible AS MATERIALIZED (
  SELECT a.id,least(coalesce(a.dialer_concurrency,3),7) AS capacity,
  (SELECT count(*) FROM calls c WHERE c.agent_id=a.id AND c.queue='pending' AND NOT c.is_completed) AS occupied
  FROM agents a CROSS JOIN campaign cp WHERE campaign_agent_can_receive(a.id,cp.id)
 ), live AS (
  SELECT count(*) FILTER(WHERE nullif(provider_call_id,'') IS NOT NULL) AS active,
  count(*) FILTER(WHERE nullif(provider_call_id,'') IS NULL) AS reserved,
  count(*) FILTER(WHERE nullif(provider_call_id,'') IS NOT NULL AND created_at<now()-interval '10 minutes') AS aged,
  min(created_at) AS oldest_at FROM tracked
 ), pace AS (
  SELECT count(*)::int AS recent_hour,count(*) FILTER(WHERE created_at>=now()-interval '1 minute')::int AS recent_minute
  FROM calls WHERE call_direction='outbound' AND created_at>=now()-interval '1 hour'
 ), per_agent AS (
  SELECT a.id,a.full_name,a.status,a.active_for_dialer AS selected,agent_phone_ready(a.id) AS phone_ready,agent_dialer_route_ready(a.id) AS route_ready,
  a.bland_number,a.talkroute_number AS zadarma_number,
  (SELECT count(*) FROM scoped c WHERE c.agent_id=a.id) AS attempts,
  (SELECT count(*) FROM scoped c WHERE c.agent_id=a.id AND c.is_live_human) AS humans,
  (SELECT count(*) FROM scoped c WHERE c.agent_id=a.id AND c.transfer_requested_at IS NOT NULL) AS transfers,
  (SELECT count(*) FROM tracked c WHERE c.agent_id=a.id AND nullif(c.provider_call_id,'') IS NOT NULL) AS in_progress,
  (SELECT count(*) FROM scoped c WHERE c.agent_id=a.id AND EXISTS(SELECT 1 FROM federal_one_zadarma_calls n WHERE n.bland_call_id=c.id AND n.agent_id=c.agent_id AND n.direction='inbound' AND (n.answered_at IS NOT NULL OR n.disposition='answered') AND NOT coalesce(n.voicemail_reached,false))) AS transfer_answers,
  (SELECT count(*) FROM native n WHERE n.agent_id=a.id AND n.direction='inbound') AS incoming,
  (SELECT count(*) FROM native n WHERE n.agent_id=a.id AND n.direction='inbound' AND (n.answered_at IS NOT NULL OR n.disposition='answered') AND NOT coalesce(n.voicemail_reached,false)) AS answered,
  (SELECT count(*) FROM native n WHERE n.agent_id=a.id AND n.direction='inbound' AND n.voicemail_reached) AS voicemail_reached,
  (SELECT count(*) FROM native n WHERE n.agent_id=a.id AND n.direction='inbound' AND n.ended_at IS NOT NULL AND n.answered_at IS NULL AND coalesce(n.disposition,'')<>'answered' AND NOT coalesce(n.voicemail_reached,false) AND coalesce(n.disposition,'unconfirmed')<>'unconfirmed') AS missed,
  (SELECT count(*) FROM voicemail v WHERE v.agent_id=a.id AND v.received_at>=v_since) AS messages,
  (SELECT count(*) FROM voicemail v WHERE v.agent_id=a.id AND v.received_at>=v_since AND v.heard_at IS NULL) AS unheard,
  (SELECT count(*) FROM voicemail v WHERE v.agent_id=a.id AND v.heard_at IS NULL) AS unheard_backlog,
  (SELECT count(*) FROM transfer_alerts t WHERE t.agent_id=a.id AND t.agent_outcome='callback_needed' AND NOT coalesce(t.callback_completed,false)) AS callbacks
  FROM agents a WHERE NOT a.is_owner AND(p_agent_id IS NULL OR a.id=p_agent_id)
  AND(a.status='active' OR EXISTS(SELECT 1 FROM scoped c WHERE c.agent_id=a.id) OR EXISTS(SELECT 1 FROM native n WHERE n.agent_id=a.id))
 ), hourly AS (
  SELECT h.hour,count(c.id) AS attempts,count(c.id) FILTER(WHERE c.is_live_human) AS humans,count(c.id) FILTER(WHERE c.transfer_requested_at IS NOT NULL) AS transfers
  FROM generate_series(date_trunc('hour',greatest(v_since,now()-interval '23 hours')),date_trunc('hour',now()),interval '1 hour') h(hour)
  LEFT JOIN scoped c ON c.created_at>=h.hour AND c.created_at<h.hour+interval '1 hour' GROUP BY h.hour
 ), outcomes AS (
  SELECT CASE WHEN queue='pending' AND NOT is_completed THEN 'in_progress' WHEN is_live_human THEN 'human'
  WHEN queue='voice_message' THEN 'customer_voicemail' WHEN queue='no_answer' THEN 'no_answer' ELSE 'other' END AS outcome FROM scoped
 )
 SELECT jsonb_build_object(
  'as_of',now(),'window',p_window,'since',CASE WHEN isfinite(v_since) THEN v_since ELSE NULL END,'timezone','America/Costa_Rica',
  'campaign',coalesce((SELECT jsonb_build_object('state',state,'call_limit',provider_call_limit,'concurrency',concurrency,'started_at',started_at,
   'accepted',(SELECT count(*) FROM calls c WHERE c.created_at>=cp.started_at AND nullif(c.provider_call_id,'') IS NOT NULL AND c.call_direction='outbound')) FROM campaign cp),'{}'::jsonb),
  'lines',(SELECT jsonb_build_object('configured',coalesce(cp.concurrency,0),'effective',least(coalesce(cp.concurrency,0),20,coalesce((SELECT sum(capacity) FROM eligible),0)),
   'active',l.active,'reserved',l.reserved,'aged',l.aged,'oldest_at',l.oldest_at,
   'hourly_target',coalesce(cp.hourly_call_target,400),'minute_limit',greatest(ceil(greatest(coalesce(cp.hourly_call_target,400),1)/60.0),least(greatest(coalesce(cp.concurrency,1),1),20)),
   'recent_hour',p.recent_hour,'recent_minute',p.recent_minute,'pacing_allowance',dialer_rate_allowance(cp.hourly_call_target,p.recent_hour,p.recent_minute,cp.concurrency),
   'available_slots',greatest(0,least(coalesce(cp.concurrency,0),20)-l.active-l.reserved),
   'agent_slots',coalesce((SELECT sum(greatest(0,capacity-occupied)) FROM eligible),0),
   'selected_agents',(SELECT count(*) FROM agents WHERE status='active' AND NOT is_owner AND active_for_dialer),
   'eligible_agents',(SELECT count(*) FROM eligible),'blocking_reason',cp.blocking_reason)
   FROM live l CROSS JOIN pace p LEFT JOIN campaign cp ON true),
  'bland',(SELECT jsonb_build_object('attempts',count(*),'humans',count(*) FILTER(WHERE is_live_human),'transfers',count(*) FILTER(WHERE transfer_requested_at IS NOT NULL),
   'destination_dialed',count(*) FILTER(WHERE talkroute_leg_created),'bridge_confirmed',count(*) FILTER(WHERE bridge_confirmed),
   'in_progress',count(*) FILTER(WHERE queue='pending' AND NOT is_completed),'no_answer',count(*) FILTER(WHERE queue='no_answer'),
   'customer_voicemail',count(*) FILTER(WHERE queue='voice_message'),'failures',count(*) FILTER(WHERE transfer_state='transfer_failed'),
   'linked_received',count(*) FILTER(WHERE EXISTS(SELECT 1 FROM federal_one_zadarma_calls n WHERE n.bland_call_id=c.id AND n.agent_id=c.agent_id AND n.direction='inbound')),
   'linked_answered',count(*) FILTER(WHERE EXISTS(SELECT 1 FROM federal_one_zadarma_calls n WHERE n.bland_call_id=c.id AND n.agent_id=c.agent_id AND n.direction='inbound' AND (n.answered_at IS NOT NULL OR n.disposition='answered') AND NOT coalesce(n.voicemail_reached,false))),
   'linked_voicemail',count(*) FILTER(WHERE EXISTS(SELECT 1 FROM federal_one_zadarma_calls n WHERE n.bland_call_id=c.id AND n.agent_id=c.agent_id AND n.direction='inbound' AND n.voicemail_reached)),
   'minutes',round(coalesce(sum(duration_seconds),0)::numeric/60,1)) FROM scoped c),
  'zadarma',(SELECT jsonb_build_object('incoming',count(*) FILTER(WHERE direction='inbound'),'outgoing',count(*) FILTER(WHERE direction='outbound'),
   'answered',count(*) FILTER(WHERE direction='inbound' AND (answered_at IS NOT NULL OR disposition='answered') AND NOT coalesce(voicemail_reached,false)),
   'voicemail_reached',count(*) FILTER(WHERE direction='inbound' AND voicemail_reached),
   'missed',count(*) FILTER(WHERE direction='inbound' AND ended_at IS NOT NULL AND answered_at IS NULL AND coalesce(disposition,'')<>'answered' AND NOT coalesce(voicemail_reached,false) AND coalesce(disposition,'unconfirmed')<>'unconfirmed'),
   'unconfirmed',count(*) FILTER(WHERE direction='inbound' AND answered_at IS NULL AND coalesce(disposition,'')<>'answered' AND NOT coalesce(voicemail_reached,false) AND (ended_at IS NOT NULL AND coalesce(disposition,'unconfirmed')='unconfirmed' OR ended_at IS NULL AND updated_at<=now()-interval '5 minutes')),
   'ringing',count(*) FILTER(WHERE direction='inbound' AND ended_at IS NULL AND answered_at IS NULL AND coalesce(disposition,'')<>'answered' AND NOT coalesce(voicemail_reached,false) AND updated_at>now()-interval '5 minutes'),
   'connected',count(*) FILTER(WHERE direction='inbound' AND ended_at IS NULL AND answered_at IS NOT NULL AND NOT coalesce(voicemail_reached,false) AND updated_at>now()-interval '5 minutes'),
   'linked_transfers',count(*) FILTER(WHERE direction='inbound' AND EXISTS(SELECT 1 FROM calls linked WHERE linked.id=native.bland_call_id AND linked.agent_id=native.agent_id)),
   'unlinked_incoming',count(*) FILTER(WHERE direction='inbound' AND bland_call_id IS NULL),
   'outgoing_answered',count(*) FILTER(WHERE direction='outbound' AND (answered_at IS NOT NULL OR disposition='answered') AND NOT coalesce(voicemail_reached,false))) FROM native),
  'voicemail',(SELECT jsonb_build_object('messages',count(*) FILTER(WHERE received_at>=v_since),'unheard',count(*) FILTER(WHERE received_at>=v_since AND heard_at IS NULL),'unheard_backlog',count(*) FILTER(WHERE heard_at IS NULL)) FROM voicemail),
  'outcomes',(SELECT jsonb_object_agg(outcome,n) FROM(SELECT outcome,count(*) AS n FROM outcomes GROUP BY outcome)o),
  'agents',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY full_name) FROM per_agent p),'[]'::jsonb),
  'hourly',coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY hour) FROM hourly h),'[]'::jsonb),
  'recent_calls',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY started_at DESC) FROM(SELECT n.pbx_call_id,a.full_name,n.direction,n.caller_number,n.called_number,n.started_at,n.disposition,n.voicemail_reached,
   ((n.answered_at IS NOT NULL OR n.disposition='answered') AND NOT coalesce(n.voicemail_reached,false)) AS answered,n.duration_seconds,(nullif(n.recording_id,'') IS NOT NULL) AS recording_available,
   (n.direction='inbound' AND EXISTS(SELECT 1 FROM calls linked WHERE linked.id=n.bland_call_id AND linked.agent_id=n.agent_id)) AS linked_transfer FROM native n LEFT JOIN agents a ON a.id=n.agent_id ORDER BY n.started_at DESC LIMIT 12)r),'[]'::jsonb),
  'events_enabled',coalesce((SELECT value='true' FROM system_config WHERE key='zadarma_call_events_configured'),false),
  'events_since',(SELECT value FROM system_config WHERE key='zadarma_call_events_since'),
  'last_event_at',(SELECT max(received_at) FROM federal_one_zadarma_events WHERE p_agent_id IS NULL OR agent_id=p_agent_id),
  'dialer_runtime',public.get_dialer_runtime()
 ) INTO v_result;
 RETURN v_result;
END;
$function$;
