
-- Fix dialer_next_batch: when one agent is at their per-agent cap,
-- CONTINUE to next agent instead of EXIT (which stops all agents).
-- Also separate global-exhausted EXIT from agent-full CONTINUE.
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
BEGIN
-- Serialize: only one batch can run at a time within this transaction
IF NOT pg_try_advisory_xact_lock(217, 1) THEN
RETURN jsonb_build_object(
'success', true,
'calls', jsonb_build_array(),
'skipped', 'batch_locked'
);
END IF;

SELECT * INTO v_campaign FROM public.campaigns ORDER BY created_at DESC LIMIT 1;

IF v_campaign.state <> 'running' THEN
RETURN jsonb_build_object('success', false, 'error', 'Campaign is not running');
END IF;

-- ── 3-minute placeholder race guard: delete orphan calls ──
DELETE FROM public.calls
WHERE call_direction = 'outbound'
AND (provider_call_id IS NULL OR provider_call_id = '')
AND created_at < now() - interval '3 minutes';

-- ── 10-minute stale-pending auto-clean (excludes active transfers) ──
UPDATE public.calls
SET is_completed  = true,
queue         = CASE WHEN queue = 'pending' THEN 'no_answer' ELSE queue END,
agent_notes   = COALESCE(agent_notes, '') || ' [Auto-cleaned: stale pending]'
WHERE queue = 'pending'
AND is_completed = false
AND created_at < now() - interval '10 minutes'
AND queue != 'fire_transfer'
AND transfer_requested_at IS NULL
AND talkroute_leg_created = false
AND ai_terminated = false;

-- ── Reset in_progress leads whose calls never launched ──
UPDATE public.leads
SET status = 'new'
WHERE status = 'in_progress'
AND NOT EXISTS (
SELECT 1 FROM public.calls c
WHERE c.lead_id = leads.id
AND c.call_direction = 'outbound'
AND c.provider_call_id IS NOT NULL
AND c.provider_call_id <> ''
)
AND NOT EXISTS (
SELECT 1 FROM public.calls p
WHERE p.lead_id = leads.id
AND p.call_direction = 'outbound'
AND p.created_at >= now() - interval '3 minutes'
);

-- ── Close leads whose phone was already dialed (in_progress) ──
UPDATE public.leads
SET status = 'closed'
WHERE status = 'in_progress'
AND telephone_normalized <> ''
AND EXISTS (
SELECT 1 FROM public.calls c
WHERE c.consumer_phone = leads.telephone_normalized
AND c.call_direction = 'outbound'
AND c.provider_call_id IS NOT NULL
AND c.provider_call_id <> ''
);

-- ── Close leads whose phone was already dialed (new) ──
UPDATE public.leads
SET status = 'closed'
WHERE status = 'new'
AND telephone_normalized <> ''
AND EXISTS (
SELECT 1 FROM public.calls c
WHERE c.consumer_phone = leads.telephone_normalized
AND c.call_direction = 'outbound'
AND c.provider_call_id IS NOT NULL
AND c.provider_call_id <> ''
);

-- ── Campaign call-limit cap ──
SELECT count(*) INTO v_calls_placed
FROM public.calls
WHERE created_at >= v_campaign.started_at
AND call_direction = 'outbound'
AND provider_call_id IS NOT NULL
AND provider_call_id <> '';

v_remaining := v_campaign.provider_call_limit - v_calls_placed;
IF v_remaining <= 0 THEN
RETURN jsonb_build_object('success', true, 'calls_to_dial', 0, 'message', 'Call limit reached');
END IF;

-- ── Global concurrency cap ──
SELECT count(*) INTO v_global_active
FROM public.calls
WHERE call_direction = 'outbound'
AND queue = 'pending'
AND is_completed = false;

v_global_remaining := LEAST(
GREATEST(v_campaign.concurrency - v_global_active, 0),
v_remaining
);

-- ── Agent loop: ordered by fewest calls since campaign start ──
FOR v_agent IN
SELECT * FROM public.agents a
WHERE a.active_for_dialer = true
AND a.status = 'active'
AND a.is_owner = false
AND a.logged_in = true
AND a.available_for_transfer = true
AND a.transfer_certified = true
AND a.bland_number IS NOT NULL AND a.bland_number <> ''
AND a.talkroute_number IS NOT NULL AND a.talkroute_number <> ''
AND EXISTS (
SELECT 1 FROM public.auth_sessions s
WHERE s.agent_id = a.id
AND s.invalidated_at IS NULL
AND s.expires_at > now()
)
ORDER BY (
SELECT count(*) FROM public.calls c
WHERE c.agent_id = a.id
AND c.created_at >= v_campaign.started_at
), a.created_at
LOOP
-- Exit entire loop only if global cap is exhausted
IF v_global_remaining <= 0 OR v_remaining <= 0 THEN
EXIT;
END IF;

-- Per-agent active-call cap
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

-- CONTINUE to next agent if this one is at capacity
IF v_agent_remaining <= 0 THEN CONTINUE; END IF;

-- ── Lead selection with retry cooldown filter ──
FOR v_lead IN
SELECT l.id, l.name, l.telephone_original, l.telephone_normalized,
l.address, l.income_range, l.home_value, l.property_information,
l.notes, l.source, l.custom_fields, l.retry_count, l.next_eligible_at
FROM public.leads l
WHERE l.status = 'new'
AND l.telephone_normalized <> ''
AND (l.next_eligible_at IS NULL OR l.next_eligible_at <= now())
AND NOT EXISTS (
SELECT 1 FROM public.calls c
WHERE c.consumer_phone = l.telephone_normalized
AND c.call_direction = 'outbound'
AND c.provider_call_id IS NOT NULL
AND c.provider_call_id <> ''
)
ORDER BY l.created_at ASC
FOR UPDATE OF l SKIP LOCKED
LIMIT v_agent_remaining
LOOP
-- Double-check phone dedup after acquiring lock
SELECT EXISTS(
SELECT 1 FROM public.calls c
WHERE c.consumer_phone = v_lead.telephone_normalized
AND c.call_direction = 'outbound'
AND c.provider_call_id IS NOT NULL
AND c.provider_call_id <> ''
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
'call_id',           v_call_id,
'lead_id',           v_lead.id,
'phone',             v_lead.telephone_normalized,
'name',              v_lead.name,
'agent_id',          v_agent.id,
'agent_name',        v_agent.full_name,
'bland_number',      v_agent.bland_number,
'bland_phone_id',    v_agent.bland_phone_id,
'bland_voice_id',    v_agent.bland_voice_id,
'talkroute_number',  v_agent.talkroute_number,
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
'success',       true,
'calls_to_dial', jsonb_array_length(to_jsonb(v_results)),
'calls',         to_jsonb(v_results)
);
END;
$function$;
