/*
# Force-redial, concurrency capping, and import-leads upsert

## Overview
Allows re-importing phone numbers that already have call records by setting
force_redial = true on the lead.  Caps agent and campaign concurrency to safe
maximums.  Replaces import_leads to do upsert (reopen existing phones instead
of inserting duplicates).  Modifies dialer_next_batch to honour force_redial
and enforce concurrency ceilings.

## Changes

### 1. New column  leads.force_redial
- boolean NOT NULL DEFAULT false
- When true, dialer_next_batch will NOT auto-close the lead and WILL select it
  even when a prior outbound call exists for that phone.

### 2. Agents concurrency floor and cap
- UPDATE agents SET dialer_concurrency = clamped value where currently outside 1-7
- ADD CHECK constraint agents_dialer_concurrency_range (1 <= dialer_concurrency <= 7)

### 3. import_leads  (REPLACE)
- If a lead with the same telephone_normalized already exists:
    UPDATE status = 'new', force_redial = true, next_eligible_at = NULL,
    retry_count = retry_count + 1
- Otherwise: INSERT as before.
- Returns { success, imported, reopened, invalid, import_id }.

### 4. dialer_next_batch  (REPLACE, base = 20260908193750)
- (a) Auto-close step excludes leads where force_redial = true.
- (b) Lead selection allows force_redial = true leads even with prior outbound calls.
- (c) After taking a lead: status = 'in_progress', force_redial = false.
- (d) Agent lines capped: LEAST(COALESCE(dialer_concurrency,3),7).
- (e) Campaign global concurrency capped at 21.
- James Spencer email_batch_20 routing, hourly pacing, retry mode all preserved.
*/

-- ============================================================
-- 1. leads.force_redial column
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='leads' AND column_name='force_redial'
  ) THEN
    ALTER TABLE public.leads ADD COLUMN force_redial boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- ============================================================
-- 2. Clamp existing agents to 1-7 and add CHECK
-- ============================================================
UPDATE public.agents
SET dialer_concurrency = LEAST(GREATEST(COALESCE(dialer_concurrency, 3), 1), 7)
WHERE dialer_concurrency IS NULL
   OR dialer_concurrency < 1
   OR dialer_concurrency > 7;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_schema='public' AND table_name='agents'
      AND constraint_name='agents_dialer_concurrency_range'
  ) THEN
    ALTER TABLE public.agents
      ADD CONSTRAINT agents_dialer_concurrency_range
      CHECK (dialer_concurrency >= 1 AND dialer_concurrency <= 7);
  END IF;
END $$;

-- ============================================================
-- 3. import_leads  (upsert: reopen existing phones)
-- ============================================================
CREATE OR REPLACE FUNCTION public.import_leads(p_leads jsonb, p_filename text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead       jsonb;
  v_valid      integer := 0;
  v_reopened   integer := 0;
  v_invalid    integer := 0;
  v_import_id  uuid;
  v_phone      text;
  v_existing   uuid;
BEGIN
  INSERT INTO public.lead_imports (filename, total_rows, valid_rows, invalid_rows, status)
  VALUES (p_filename, jsonb_array_length(p_leads), 0, 0, 'processing')
  RETURNING id INTO v_import_id;

  FOR v_lead IN SELECT * FROM jsonb_array_elements(p_leads) LOOP
    IF v_lead->>'name' IS NOT NULL AND v_lead->>'telephone_original' IS NOT NULL THEN
      v_phone := public.normalize_phone(v_lead->>'telephone_original');

      SELECT id INTO v_existing
      FROM public.leads
      WHERE telephone_normalized = v_phone
      LIMIT 1;

      IF v_existing IS NOT NULL THEN
        UPDATE public.leads
        SET status          = 'new',
            force_redial    = true,
            next_eligible_at = NULL,
            retry_count     = COALESCE(retry_count, 0) + 1
        WHERE id = v_existing;
        v_reopened := v_reopened + 1;
      ELSE
        INSERT INTO public.leads (
          name, telephone_original, telephone_normalized, address,
          income_range, home_value, property_information, notes,
          original_agent_information, source, custom_fields, status
        ) VALUES (
          v_lead->>'name',
          v_lead->>'telephone_original',
          v_phone,
          COALESCE(v_lead->>'address', ''),
          COALESCE(v_lead->>'income_range', ''),
          COALESCE(v_lead->>'home_value', ''),
          COALESCE(v_lead->>'property_information', ''),
          COALESCE(v_lead->>'notes', ''),
          '',
          COALESCE(v_lead->>'source', ''),
          COALESCE(v_lead->'custom_fields', '{}'::jsonb),
          'new'
        );
        v_valid := v_valid + 1;
      END IF;
    ELSE
      v_invalid := v_invalid + 1;
    END IF;
  END LOOP;

  UPDATE public.lead_imports
  SET valid_rows = v_valid + v_reopened, invalid_rows = v_invalid, status = 'completed'
  WHERE id = v_import_id;

  RETURN jsonb_build_object(
    'success', true,
    'imported', v_valid,
    'reopened', v_reopened,
    'invalid', v_invalid,
    'import_id', v_import_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.import_leads(jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_leads(jsonb, text) TO authenticated, anon;

-- ============================================================
-- 4. dialer_next_batch  (with force_redial + concurrency caps)
-- ============================================================
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