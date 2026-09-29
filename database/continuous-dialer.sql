-- Explicit NULL means continuous dialing. Existing finite/test limits retain their meaning.
-- Preserve Stop/epoch, lead exclusions, pacing, balance, routes and concurrency safeguards.
SET lock_timeout = '5s';


DO $guard$ BEGIN IF md5(pg_get_functiondef('public.dialer_next_batch()'::regprocedure)) <> '3fde8f4b23ea8502e0e823587809cf3e' THEN RAISE EXCEPTION 'Live dialer_next_batch changed; review before applying'; END IF; END $guard$;

DO $guard$ BEGIN IF md5(pg_get_functiondef('public.dialer_next_batch_unbounded()'::regprocedure)) <> 'a4c3841da3360207a36cb2f4cc9c76e4' THEN RAISE EXCEPTION 'Live dialer_next_batch_unbounded changed; review before applying'; END IF; END $guard$;

DO $guard$ BEGIN IF md5(pg_get_functiondef('public.retry_dialer_next_batch()'::regprocedure)) <> '2d3ba98bd750b24d7f585f501ccc0ba3' THEN RAISE EXCEPTION 'Live retry_dialer_next_batch changed; review before applying'; END IF; END $guard$;

DO $guard$ BEGIN IF md5(pg_get_functiondef('public.get_admin_stats()'::regprocedure)) <> 'd88e7ed93b3bd8d8409267262b91c8e4' THEN RAISE EXCEPTION 'Live get_admin_stats changed; review before applying'; END IF; END $guard$;

DO $guard$ BEGIN IF md5(pg_get_functiondef('public.dialer_dispatch_allowed(uuid,timestamp with time zone,uuid,bigint)'::regprocedure)) <> 'df2da722c537db8866385e66d3e6fdc2' THEN RAISE EXCEPTION 'Live dialer_dispatch_allowed changed; review before applying'; END IF; END $guard$;

DO $guard$ BEGIN IF md5(pg_get_functiondef('public.campaign_start(integer,integer)'::regprocedure)) <> 'eef1a332b1fe390ca93d62544c688c87' THEN RAISE EXCEPTION 'Live campaign_start changed; review before applying'; END IF; END $guard$;

ALTER TABLE public.campaigns ALTER COLUMN provider_call_limit DROP NOT NULL;
ALTER TABLE public.campaigns ALTER COLUMN provider_call_limit SET DEFAULT NULL;
COMMENT ON COLUMN public.campaigns.provider_call_limit IS 'Total accepted attempts allowed in this run; NULL means continuous until operator Stop or an existing safety stop.';

CREATE OR REPLACE FUNCTION public.dialer_run_remaining(p_call_limit integer, p_accepted bigint, p_concurrency integer)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
 SELECT CASE WHEN p_call_limit IS NULL
   THEN greatest(0, least(coalesce(p_concurrency, 0), 20))
   ELSE greatest(0::bigint, p_call_limit::bigint - greatest(coalesce(p_accepted, 0), 0))::integer
 END;
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

v_remaining := public.dialer_run_remaining(v_campaign.provider_call_limit, v_calls_placed, v_campaign.concurrency);
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

CREATE OR REPLACE FUNCTION public.dialer_next_batch_unbounded()
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
AND queue='pending' AND NOT is_completed
AND created_at < now() - interval '3 minutes';

-- Provider-accepted calls remain pending until a webhook or backfill confirms
-- completion. Local row age cannot prove no-answer or free a concurrency slot.

-- Call-limit cap
SELECT count(*) INTO v_calls_placed
FROM public.calls
WHERE created_at >= v_campaign.started_at
AND call_direction = 'outbound'
AND provider_call_id IS NOT NULL AND provider_call_id <> '';

v_remaining := public.dialer_run_remaining(v_campaign.provider_call_limit, v_calls_placed, v_campaign.concurrency);
IF v_remaining <= 0 THEN
RETURN jsonb_build_object('success', true, 'calls_to_dial', 0, 'message', 'Call limit reached');
END IF;

-- Count reservations as well as accepted calls so concurrent workers cannot
-- exceed the configured pace while a provider request is still in flight.
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

-- Global concurrency cap
SELECT count(*) INTO v_global_active
FROM public.calls
WHERE call_direction = 'outbound'
AND queue = 'pending'
AND is_completed = false;

v_global_remaining := LEAST(
GREATEST(v_campaign.concurrency - v_global_active, 0),
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
AND a.transfer_certified = true
AND a.bland_number_owned_active = true
AND a.talkroute_verified = true
AND coalesce(a.bland_phone_id,'') <> ''
AND coalesce(a.bland_voice_id,'') <> ''
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
GREATEST(v_agent.dialer_concurrency - v_active, 0),
v_global_remaining, v_remaining
);
IF v_agent_remaining <= 0 THEN CONTINUE; END IF;

FOR v_lead IN
SELECT rl.id, rl.phone_normalized, rl.consumer_name, rl.address,
rl.income_range, rl.home_value, rl.property_information, rl.custom_fields
FROM public.retry_leads rl
WHERE rl.status = 'new'
AND rl.exclusion_reason IS NULL
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
-- James Spencer prioritizes email_batch_20, then the unassigned shared pool.
-- All other agents retain non-email leads.
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

-- Close leads already dialed
UPDATE public.leads SET status = 'closed'
WHERE status IN ('new','in_progress')
AND telephone_normalized <> ''
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
AND a.transfer_certified = true
AND a.bland_number_owned_active = true
AND a.talkroute_verified = true
AND coalesce(a.bland_phone_id,'') <> ''
AND coalesce(a.bland_voice_id,'') <> ''
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
GREATEST(v_agent.dialer_concurrency - v_active, 0),
v_global_remaining, v_remaining
);
IF v_agent_remaining <= 0 THEN CONTINUE; END IF;

FOR v_lead IN
SELECT l.id, l.name, l.telephone_original, l.telephone_normalized,
l.address, l.income_range, l.home_value, l.property_information,
l.notes, l.source, l.custom_fields, l.retry_count, l.next_eligible_at
FROM public.leads l
WHERE l.status = 'new'
AND l.telephone_normalized <> ''
AND (l.next_eligible_at IS NULL OR l.next_eligible_at <= now())
-- James retains first priority on his email batch and can use the unassigned
-- shared pool when that batch is exhausted. Other agents keep their current pool.
AND CASE
WHEN v_agent.id = v_james_id THEN
  l.source = 'email_batch_20'
  OR (l.source IS DISTINCT FROM 'email_batch_20' AND l.assigned_agent_id IS NULL)
ELSE l.source <> 'email_batch_20'
END
AND NOT EXISTS (
SELECT 1 FROM public.calls c
WHERE c.consumer_phone = l.telephone_normalized
AND c.call_direction = 'outbound'
AND c.provider_call_id IS NOT NULL AND c.provider_call_id <> ''
)
ORDER BY CASE WHEN v_agent.id = v_james_id AND l.source = 'email_batch_20' THEN 0 ELSE 1 END,
l.created_at ASC
FOR UPDATE OF l SKIP LOCKED
LIMIT v_agent_remaining
LOOP
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

UPDATE public.leads SET status = 'in_progress' WHERE id = v_lead.id;

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
'call_id', v_call_id, 'lead_id', v_lead.id,
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

CREATE OR REPLACE FUNCTION public.retry_dialer_next_batch()
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
v_global_active   integer;
v_global_remaining integer;
BEGIN
-- Serialize
IF NOT pg_try_advisory_xact_lock(264, 1) THEN
RETURN jsonb_build_object('success', true, 'calls', jsonb_build_array(), 'skipped', 'batch_locked');
END IF;

-- Get most recent campaign (the retry one)
SELECT * INTO v_campaign FROM public.campaigns ORDER BY created_at DESC LIMIT 1;

IF v_campaign.state <> 'running' THEN
RETURN jsonb_build_object('success', false, 'error', 'Retry campaign is not running');
END IF;

-- Clean stale placeholders (3 min)
DELETE FROM public.calls
WHERE call_direction = 'outbound'
AND (provider_call_id IS NULL OR provider_call_id = '')
AND created_at < now() - interval '3 minutes';

-- Auto-clean stale pending (10 min, exclude active transfers)
UPDATE public.calls
SET is_completed = true,
queue = CASE WHEN queue = 'pending' THEN 'no_answer' ELSE queue END,
agent_notes = COALESCE(agent_notes, '') || ' [Auto-cleaned: stale pending]'
WHERE queue = 'pending'
AND is_completed = false
AND created_at < now() - interval '10 minutes'
AND transfer_requested_at IS NULL
AND talkroute_leg_created = false;

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

-- Call-limit cap
SELECT count(*) INTO v_calls_placed
FROM public.calls
WHERE created_at >= v_campaign.started_at
AND call_direction = 'outbound'
AND provider_call_id IS NOT NULL AND provider_call_id <> '';

v_remaining := public.dialer_run_remaining(v_campaign.provider_call_limit, v_calls_placed, v_campaign.concurrency);
IF v_remaining <= 0 THEN
RETURN jsonb_build_object('success', true, 'calls_to_dial', 0, 'message', 'Call limit reached');
END IF;

-- Global concurrency cap
SELECT count(*) INTO v_global_active
FROM public.calls
WHERE call_direction = 'outbound'
AND queue = 'pending'
AND is_completed = false;

v_global_remaining := LEAST(
GREATEST(v_campaign.concurrency - v_global_active, 0),
v_remaining
);

-- Agent loop: round-robin by fewest calls
FOR v_agent IN
SELECT * FROM public.agents a
WHERE a.active_for_dialer = true
AND a.status = 'active'
AND a.is_owner = false
AND a.available_for_transfer = true
AND a.transfer_certified = true
AND a.bland_number IS NOT NULL AND a.bland_number <> ''
AND a.talkroute_number IS NOT NULL AND a.talkroute_number <> ''
ORDER BY (
SELECT count(*) FROM public.calls c
WHERE c.agent_id = a.id
AND c.created_at >= v_campaign.started_at
), a.created_at
LOOP
IF v_global_remaining <= 0 OR v_remaining <= 0 THEN EXIT; END IF;

-- Per-agent active cap
SELECT count(*) INTO v_active
FROM public.calls
WHERE agent_id = v_agent.id
AND queue = 'pending'
AND is_completed = false;

v_agent_remaining := LEAST(
GREATEST(v_agent.dialer_concurrency - v_active, 0),
v_global_remaining,
v_remaining
);

IF v_agent_remaining <= 0 THEN CONTINUE; END IF;

-- Lead selection from retry_leads
FOR v_lead IN
SELECT rl.id, rl.phone_normalized, rl.consumer_name, rl.address,
rl.income_range, rl.home_value, rl.property_information, rl.custom_fields
FROM public.retry_leads rl
WHERE rl.status = 'new'
AND rl.exclusion_reason IS NULL
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
'call_id',           v_call_id,
'retry_lead_id',     v_lead.id,
'phone',             v_lead.phone_normalized,
'name',              v_lead.consumer_name,
'agent_id',          v_agent.id,
'agent_name',        v_agent.full_name,
'bland_number',      v_agent.bland_number,
'bland_phone_id',    v_agent.bland_phone_id,
'bland_voice_id',    v_agent.bland_voice_id,
'talkroute_number',  v_agent.talkroute_number
));

v_remaining := v_remaining - 1;
v_global_remaining := v_global_remaining - 1;
EXCEPTION WHEN unique_violation THEN
UPDATE public.retry_leads SET status = 'closed' WHERE id = v_lead.id;
END;
END LOOP;
END LOOP;

RETURN jsonb_build_object(
'success',       true,
'calls_to_dial', jsonb_array_length(to_jsonb(v_results)),
'calls',         to_jsonb(v_results)
);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_et timestamptz;v_wk timestamptz;v_c campaigns%ROWTYPE;v_ft jsonb;v_fw jsonb;v_fa jsonb;v_er jsonb;v_al jsonb[]:=ARRAY[]::jsonb[];v_ag record;v_su jsonb;v_metrics jsonb;
BEGIN
v_et:=date_trunc('day',now() AT TIME ZONE 'America/Costa_Rica') AT TIME ZONE 'America/Costa_Rica';
v_wk:=date_trunc('week',now() AT TIME ZONE 'America/Costa_Rica') AT TIME ZONE 'America/Costa_Rica';
SELECT * INTO v_c FROM campaigns ORDER BY created_at DESC LIMIT 1;
v_ft:=public.get_delivery_metrics(v_et);
v_fw:=public.get_delivery_metrics(v_wk);
v_fa:=public.get_delivery_metrics('-infinity'::timestamptz);
SELECT get_recent_errors(20) INTO v_er;
v_su:=jsonb_build_object('campaign_state',COALESCE(v_c.state,'idle'),'dialer_activated',COALESCE(v_c.dialer_activated,false),'concurrency',COALESCE(v_c.concurrency,1),'provider_call_limit',v_c.provider_call_limit,'daily_call_limit',v_c.daily_call_target,'daily_minute_cap',v_c.daily_minute_cap,'daily_minutes_used',(v_ft->>'total_minutes')::numeric,'leads_remaining',(SELECT count(*) FROM leads WHERE status='new'),'calls_attempted_today',(v_ft->>'calls_attempted')::int,'live_humans_today',(v_ft->>'live_humans_reached')::int,'human_drops_today',(v_ft->>'human_drop_count')::int,'currently_pending',(SELECT count(*) FROM calls WHERE call_direction='outbound' AND queue='pending' AND NOT is_completed AND nullif(provider_call_id,'') IS NOT NULL),'active_agent_count',(SELECT count(*) FROM agents WHERE status='active' AND NOT is_owner),'logged_in_count',(SELECT count(DISTINCT agent_id) FROM auth_sessions WHERE expires_at>now()),'currently_receiving',(SELECT count(*) FROM agents WHERE status='active' AND NOT is_owner AND available_for_transfer));
FOR v_ag IN SELECT id,full_name,role,status,available_for_transfer,active_for_dialer,dialer_concurrency,bland_number,talkroute_number,is_owner,agent_direct_number,transfer_certified,inbound_configured,provider_sync_status,mapping_verified FROM agents WHERE status='active' ORDER BY is_owner DESC,full_name
LOOP
SELECT jsonb_build_object('outbound_attempts_today',count(*) FILTER (WHERE c.created_at>=v_et AND true),
'live_humans',count(*) FILTER (WHERE c.created_at>=v_et AND c.is_live_human),
'human_drops',count(*) FILTER (WHERE c.created_at>=v_et AND c.queue='human_drop'),
'fire_transfers',count(*) FILTER (WHERE c.created_at>=v_et AND c.queue='fire_transfer'),
'no_answers',count(*) FILTER (WHERE c.created_at>=v_et AND c.queue='no_answer'),
'voice_messages',count(*) FILTER (WHERE c.created_at>=v_et AND c.queue='voice_message'),
'transfers_requested_today',count(*) FILTER (WHERE c.created_at>=v_et AND c.transfer_requested_at is not null),
'talkroute_leg_created_today',count(*) FILTER (WHERE c.created_at>=v_et AND c.talkroute_leg_created),
'talkroute_answered_today',count(*) FILTER (WHERE c.created_at>=v_et AND c.talkroute_answered),
'bridge_confirmed_today',count(*) FILTER (WHERE c.created_at>=v_et AND c.bridge_confirmed),
'outbound_attempts_week',count(*) FILTER (WHERE c.created_at>=v_wk AND true),
'live_humans_week',count(*) FILTER (WHERE c.created_at>=v_wk AND c.is_live_human),
'human_drops_week',count(*) FILTER (WHERE c.created_at>=v_wk AND c.queue='human_drop'),
'fire_transfers_week',count(*) FILTER (WHERE c.created_at>=v_wk AND c.queue='fire_transfer'),
'no_answers_week',count(*) FILTER (WHERE c.created_at>=v_wk AND c.queue='no_answer'),
'voice_messages_week',count(*) FILTER (WHERE c.created_at>=v_wk AND c.queue='voice_message'),
'transfers_requested_week',count(*) FILTER (WHERE c.created_at>=v_wk AND c.transfer_requested_at is not null),
'talkroute_leg_created_week',count(*) FILTER (WHERE c.created_at>=v_wk AND c.talkroute_leg_created),
'talkroute_answered_week',count(*) FILTER (WHERE c.created_at>=v_wk AND c.talkroute_answered),
'bridge_confirmed_week',count(*) FILTER (WHERE c.created_at>=v_wk AND c.bridge_confirmed),
'outbound_attempts_all',count(*) FILTER (WHERE true AND true),
'live_humans_all',count(*) FILTER (WHERE true AND c.is_live_human),
'human_drops_all',count(*) FILTER (WHERE true AND c.queue='human_drop'),
'fire_transfers_all',count(*) FILTER (WHERE true AND c.queue='fire_transfer'),
'no_answers_all',count(*) FILTER (WHERE true AND c.queue='no_answer'),
'voice_messages_all',count(*) FILTER (WHERE true AND c.queue='voice_message'),
'transfers_requested_all',count(*) FILTER (WHERE true AND c.transfer_requested_at is not null),
'talkroute_leg_created_all',count(*) FILTER (WHERE true AND c.talkroute_leg_created),
'talkroute_answered_all',count(*) FILTER (WHERE true AND c.talkroute_answered),
'bridge_confirmed_all',count(*) FILTER (WHERE true AND c.bridge_confirmed),
'pending_calls',count(*) FILTER (WHERE c.queue='pending' AND NOT c.is_completed),
'last_call_time',max(c.created_at),
'likely_real_conversation_today',count(*) FILTER (WHERE c.created_at>=v_et AND c.bridge_confirmed AND c.post_transfer_duration_seconds>=45 AND c.rep_first_speech_at IS NOT NULL),
'total_minutes_today',round(coalesce(sum(c.duration_seconds) FILTER (WHERE c.created_at>=v_et),0)::numeric/60,1),
'productive_minutes_today',round(coalesce(sum(c.post_transfer_duration_seconds) FILTER (WHERE c.created_at>=v_et AND c.bridge_confirmed AND c.post_transfer_duration_seconds>0),0)::numeric/60,1),
'wasted_minutes_today',round(coalesce(sum(c.duration_seconds) FILTER (WHERE c.created_at>=v_et AND c.queue IN('no_answer','voice_message')),0)::numeric/60,1)) INTO v_metrics FROM public.calls c WHERE c.agent_id=v_ag.id AND c.call_direction='outbound' AND nullif(c.provider_call_id,'') IS NOT NULL;
v_al:=array_append(v_al,v_metrics || jsonb_build_object('dialer_eligible',public.campaign_agent_can_receive(v_ag.id,v_c.id),'transfer_certified',v_ag.transfer_certified,'inbound_configured',v_ag.inbound_configured,'provider_sync_status',v_ag.provider_sync_status,'mapping_verified',v_ag.mapping_verified,'phone_ready',public.agent_phone_ready(v_ag.id),'currently_receiving',EXISTS(SELECT 1 FROM federal_one_zadarma_calls n WHERE n.agent_id=v_ag.id AND n.direction='inbound' AND n.answered_at IS NOT NULL AND n.ended_at IS NULL AND NOT coalesce(n.voicemail_reached,false) AND n.updated_at>now()-interval '5 minutes'),'id',v_ag.id,'full_name',v_ag.full_name,'role',v_ag.role,'status',v_ag.status,'available_for_transfer',v_ag.available_for_transfer,'active_for_dialer',v_ag.active_for_dialer,'dialer_concurrency',v_ag.dialer_concurrency,'bland_number',v_ag.bland_number,'talkroute_number',v_ag.talkroute_number,'is_owner',v_ag.is_owner,'agent_direct_number',v_ag.agent_direct_number,'calls_today',(SELECT count(*) FROM calls c WHERE nullif(c.provider_call_id,'') IS NOT NULL AND c.call_direction='outbound' AND c.agent_id=v_ag.id AND c.created_at>=v_et AND c.call_direction='outbound'),'humans_today',(SELECT count(*) FROM calls c WHERE nullif(c.provider_call_id,'') IS NOT NULL AND c.call_direction='outbound' AND c.agent_id=v_ag.id AND c.created_at>=v_et AND c.is_live_human),'transfers_today',(SELECT count(*) FROM calls c WHERE nullif(c.provider_call_id,'') IS NOT NULL AND c.call_direction='outbound' AND c.agent_id=v_ag.id AND c.created_at>=v_et AND c.bridge_confirmed),'calls_all_time',(SELECT count(*) FROM calls c WHERE nullif(c.provider_call_id,'') IS NOT NULL AND c.call_direction='outbound' AND c.agent_id=v_ag.id AND c.call_direction='outbound'),'transfers_all_time',(SELECT count(*) FROM calls c WHERE nullif(c.provider_call_id,'') IS NOT NULL AND c.call_direction='outbound' AND c.agent_id=v_ag.id AND c.bridge_confirmed)));
END LOOP;
v_su:=v_su||jsonb_build_object('blocking_reason',v_c.blocking_reason,'dialer_status',v_c.dialer_status,'currently_receiving',(SELECT count(DISTINCT agent_id) FROM federal_one_zadarma_calls WHERE direction='inbound' AND answered_at IS NOT NULL AND ended_at IS NULL AND NOT coalesce(voicemail_reached,false) AND updated_at>now()-interval '5 minutes'));
-- Reuse the three delivery metrics already calculated above.
v_su:=v_su||jsonb_build_object('funnel_today',v_ft,'funnel_week',v_fw,'funnel_all',v_fa,'calls_attempted_week',v_fw->'calls_attempted','live_humans_week',v_fw->'live_humans_reached','live_humans_all',v_fa->'live_humans_reached','route_ready_count',public.count_available_agents(),'phone_ready_count',(SELECT count(*) FROM agents WHERE status='active' AND NOT is_owner AND public.agent_phone_ready(id)), 'transfers_requested_today',v_ft->'transfers_requested', 'talkroute_dialed_today',v_ft->'talkroute_dialed', 'agent_answered_today',v_ft->'agent_answered', 'bridge_confirmed_today',v_ft->'bridge_confirmed', 'confirmed_transfer_failures_today',v_ft->'confirmed_transfer_failures', 'transfer_failed_unverified_today',v_ft->'transfer_failed_unverified', 'transfers_requested_week',v_fw->'transfers_requested', 'talkroute_dialed_week',v_fw->'talkroute_dialed', 'agent_answered_week',v_fw->'agent_answered', 'bridge_confirmed_week',v_fw->'bridge_confirmed', 'confirmed_transfer_failures_week',v_fw->'confirmed_transfer_failures', 'transfer_failed_unverified_week',v_fw->'transfer_failed_unverified', 'transfers_requested_all',v_fa->'transfers_requested', 'talkroute_dialed_all',v_fa->'talkroute_dialed', 'agent_answered_all',v_fa->'agent_answered', 'bridge_confirmed_all',v_fa->'bridge_confirmed', 'confirmed_transfer_failures_all',v_fa->'confirmed_transfer_failures', 'transfer_failed_unverified_all',v_fa->'transfer_failed_unverified');
v_su:=v_su||jsonb_build_object('as_of',now(),'timezone','America/Costa_Rica','campaign_started_at',v_c.started_at,
'active_call_count',(SELECT count(*) FROM calls WHERE call_direction='outbound' AND queue='pending' AND NOT is_completed AND nullif(provider_call_id,'') IS NOT NULL),
'reserved_call_count',(SELECT count(*) FROM calls WHERE call_direction='outbound' AND queue='pending' AND NOT is_completed AND nullif(provider_call_id,'') IS NULL),
'errors_recent',v_er,'dialer_runtime',public.get_dialer_runtime());
RETURN jsonb_build_object('summary',v_su,'funnel_today',v_ft,'funnel_week',v_fw,'funnel_all',v_fa,'errors',v_er,'agents',to_jsonb(v_al));
END;$function$;

CREATE OR REPLACE FUNCTION public.dialer_dispatch_allowed(p_campaign_id uuid, p_started_at timestamp with time zone, p_agent_id uuid, p_epoch bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
 select exists (
 select 1 from public.campaigns c join public.agents a on a.id=p_agent_id
 where c.id=p_campaign_id and c.id=(select id from public.campaigns order by created_at desc limit 1)
 and (c.provider_call_limit IS NULL OR (select count(*) from public.calls cap where cap.call_direction='outbound' and cap.created_at>=c.started_at and nullif(cap.provider_call_id,'') is not null)<c.provider_call_limit)
 and c.dispatch_epoch=p_epoch and c.started_at is not distinct from p_started_at and c.state='running' and c.dialer_activated
 and a.status='active' and not a.is_owner and a.active_for_dialer 
 and a.transfer_certified and public.campaign_agent_can_receive(a.id,c.id)
 and (select count(*) from public.calls x where x.call_direction='outbound' and x.queue='pending'
      and not x.is_completed and nullif(x.provider_call_id,'') is not null)<least(c.concurrency,20)
 and (select count(*) from public.calls x where x.agent_id=a.id and x.queue='pending'
      and not x.is_completed and nullif(x.provider_call_id,'') is not null)<least(coalesce(a.dialer_concurrency,3),7)
 );
$function$;

CREATE OR REPLACE FUNCTION public.campaign_start(p_concurrency integer DEFAULT 3, p_call_limit integer DEFAULT NULL::integer)
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
IF p_concurrency NOT BETWEEN 1 AND 20 OR p_concurrency IS NULL OR (p_call_limit IS NOT NULL AND p_call_limit<=0) THEN
 RETURN jsonb_build_object('success',false,'error','Choose 1-20 simultaneous lines and either continuous dialing or a positive call limit.');
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
