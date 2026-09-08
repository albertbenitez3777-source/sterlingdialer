ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS hourly_call_target integer NOT NULL DEFAULT 400;

CREATE OR REPLACE FUNCTION public.dialer_rate_allowance(p_target integer,p_recent_hour integer,p_recent_minute integer)
RETURNS integer LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path TO 'public'
AS $function$
  SELECT greatest(0,least(
    greatest(coalesce(p_target,400),1)-greatest(coalesce(p_recent_hour,0),0),
    ceil(greatest(coalesce(p_target,400),1)/60.0)::integer-greatest(coalesce(p_recent_minute,0),0)
  ));
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

-- Provider-accepted calls remain pending until a webhook or backfill confirms
-- completion. Local row age cannot prove no-answer or free a concurrency slot.

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

-- Count reservations as well as accepted calls so concurrent workers cannot
-- exceed the configured pace while a provider request is still in flight.
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
AND a.available_for_transfer = true
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
AND a.available_for_transfer = true
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
-- AGENT-LEAD ROUTING: James gets email leads, others get non-email leads
AND CASE
WHEN v_agent.id = v_james_id THEN l.source = 'email_batch_20'
ELSE l.source <> 'email_batch_20'
END
AND NOT EXISTS (
SELECT 1 FROM public.calls c
WHERE c.consumer_phone = l.telephone_normalized
AND c.call_direction = 'outbound'
AND c.provider_call_id IS NOT NULL AND c.provider_call_id <> ''
)
ORDER BY l.created_at ASC
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
$function$
;

DO $test$
BEGIN
  IF public.dialer_rate_allowance(400,0,0)<>7
    OR public.dialer_rate_allowance(400,395,0)<>5
    OR public.dialer_rate_allowance(400,400,0)<>0
    OR public.dialer_rate_allowance(400,0,7)<>0
    OR public.dialer_rate_allowance(300,0,0)<>5
    OR public.dialer_rate_allowance(300,295,4)<>1
    OR public.dialer_rate_allowance(400,9999,99)<>0 THEN
    RAISE EXCEPTION 'Hourly/minute pacing regression failed';
  END IF;
  IF position('public.dialer_rate_allowance(v_campaign.hourly_call_target' in pg_get_functiondef('public.dialer_next_batch()'::regprocedure))=0
    OR position('Auto-cleaned: stale pending' in pg_get_functiondef('public.dialer_next_batch()'::regprocedure))>0 THEN
    RAISE EXCEPTION 'Dialer must enforce pacing and preserve provider-pending calls';
  END IF;
END;
$test$;
