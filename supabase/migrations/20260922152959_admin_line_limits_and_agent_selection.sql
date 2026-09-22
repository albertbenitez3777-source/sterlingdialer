-- Admin selection controls campaign routing independently of desktop/personal availability.
-- Keep the existing global ceiling, per-agent caps, suppression, and dispatch checks.

CREATE OR REPLACE FUNCTION public.agent_dialer_route_ready(p_agent_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
 SELECT EXISTS (
 SELECT 1 FROM public.agents a
 WHERE a.id=p_agent_id AND a.status='active' AND NOT a.is_owner
 AND a.active_for_dialer  AND a.transfer_certified
 AND a.inbound_configured AND a.mapping_verified AND a.provider_sync_status='synced'
 AND regexp_replace(coalesce(a.bland_number,''),'[^0-9]','','g') ~ '^[1-9][0-9]{7,14}$'
 AND regexp_replace(coalesce(a.talkroute_number,''),'[^0-9]','','g') ~ '^[1-9][0-9]{7,14}$'
 AND nullif(a.zadarma_sip_login,'') IS NOT NULL
 );
$function$;

CREATE OR REPLACE FUNCTION public.campaign_agent_can_receive(p_agent_id uuid, p_campaign_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
 SELECT EXISTS (
 SELECT 1 FROM public.agents a JOIN public.campaigns c ON c.id=p_campaign_id
 WHERE a.id=p_agent_id AND a.status='active' AND NOT a.is_owner
 AND a.active_for_dialer  AND a.transfer_certified
 AND public.agent_dialer_route_ready(a.id)
 AND CASE WHEN c.offline_voicemail_test_until IS NOT NULL THEN
 c.offline_voicemail_test_until>now()
 AND c.started_at>=now()-interval '30 minutes'
 AND c.provider_call_limit BETWEEN 1 AND 20
 AND a.id=ANY(c.offline_voicemail_test_agents)
 ELSE true END
 );
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
      and not x.is_completed and nullif(x.provider_call_id,'') is not null)<least(c.concurrency,12)
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

-- Global concurrency cap (hard ceiling 12)
SELECT count(*) INTO v_global_active
FROM public.calls
WHERE call_direction = 'outbound'
AND queue = 'pending'
AND is_completed = false;

v_global_remaining := LEAST(
GREATEST(LEAST(v_campaign.concurrency, 12) - v_global_active, 0),
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
IF p_concurrency NOT BETWEEN 1 AND 12 OR p_concurrency IS NULL OR p_call_limit IS NULL OR p_call_limit<=0 THEN
 RETURN jsonb_build_object('success',false,'error','Choose 1-12 simultaneous lines and a positive call limit.');
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

CREATE OR REPLACE FUNCTION public.set_agent_dialer_selection(p_agent_id uuid, p_selected boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF p_selected IS NULL THEN RETURN jsonb_build_object('success',false,'error','Choose On or Off.'); END IF;
 UPDATE public.agents SET active_for_dialer=p_selected
 WHERE id=p_agent_id AND status='active' AND NOT is_owner AND role IN ('agent','supervisor');
 IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','Active agent not found.'); END IF;
 RETURN jsonb_build_object('success',true,'agent_id',p_agent_id,'selected',p_selected);
END;
$$;

REVOKE ALL ON FUNCTION public.agent_dialer_route_ready(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.agent_dialer_route_ready(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.campaign_agent_can_receive(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_agent_can_receive(uuid,uuid) TO service_role;

REVOKE ALL ON FUNCTION public.dialer_dispatch_allowed(uuid,timestamptz,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dialer_dispatch_allowed(uuid,timestamptz,uuid,bigint) TO service_role;

REVOKE ALL ON FUNCTION public.dialer_next_batch() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dialer_next_batch() TO service_role;

REVOKE ALL ON FUNCTION public.dialer_next_batch_unbounded() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dialer_next_batch_unbounded() TO service_role;

REVOKE ALL ON FUNCTION public.campaign_start(integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_start(integer,integer) TO service_role;

REVOKE ALL ON FUNCTION public.set_agent_dialer_selection(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_agent_dialer_selection(uuid,boolean) TO service_role;
