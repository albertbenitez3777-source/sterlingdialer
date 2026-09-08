/*
# v260: Remove auth_session gate from dialer eligibility

## Summary
Removes the auth_sessions existence check and the logged_in flag check from all
dialer-related eligibility predicates. These agents have their Talkroute phones
in hand and do not need an active web session to receive outbound calls.

## Functions modified
1. **dialer_next_batch()** - Main dialer function that assigns leads to agents.
   Removed: `AND a.logged_in = true` and `AND EXISTS(SELECT 1 FROM auth_sessions ...)`
2. **count_available_agents()** - Preflight count used by campaign start.
   Removed: same two conditions.
3. **campaign_start()** - Campaign start eligibility check.
   Removed: same two conditions.

## Safety gates PRESERVED (unchanged)
- `a.active_for_dialer = true`
- `a.status = 'active'` (blocks archived John McCarthy)
- `a.is_owner = false`
- `a.available_for_transfer = true`
- `a.transfer_certified = true`
- `a.bland_number IS NOT NULL AND a.bland_number <> ''`
- `a.talkroute_number IS NOT NULL AND a.talkroute_number <> ''`
- Per-agent concurrency cap (dialer_concurrency column)
- Global campaign concurrency cap
- Advisory lock serialization
- Phone-level dedup
- Retry cooldowns

## Notes
1. John McCarthy remains excluded because his status='archived'.
2. Transfer routing still uses talkroute_number exclusively.
3. Inbound call handling is completely independent and unaffected.
4. Per-agent concurrency remains at 3 (set in agents table).
5. Global campaign concurrency remains at 9.
*/

-- ══════════════════════════════════════════════════════════════════════
-- 1. dialer_next_batch() — remove logged_in + auth_session gate
-- ══════════════════════════════════════════════════════════════════════
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

-- ══════════════════════════════════════════════════════════════════════
-- 2. count_available_agents() — remove logged_in + auth_session gate
-- ══════════════════════════════════════════════════════════════════════
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
    AND a.transfer_certified = true
    AND a.bland_number IS NOT NULL AND a.bland_number <> ''
    AND a.talkroute_number IS NOT NULL AND a.talkroute_number <> '';
$function$;

-- ══════════════════════════════════════════════════════════════════════
-- 3. campaign_start() — remove logged_in + auth_session gate
-- ══════════════════════════════════════════════════════════════════════
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
  SELECT * INTO v_campaign FROM public.campaigns ORDER BY created_at DESC LIMIT 1;

  UPDATE public.calls
  SET queue = 'no_answer', is_completed = true,
      agent_notes = COALESCE(agent_notes, '') || ' [Auto-cleaned: stale pending]'
  WHERE queue = 'pending' AND created_at < now() - interval '10 minutes';

  GET DIAGNOSTICS v_cleaned_count = ROW_COUNT;

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
    AND a.available_for_transfer = true
    AND a.transfer_certified = true
    AND a.bland_number IS NOT NULL AND a.bland_number <> ''
    AND a.talkroute_number IS NOT NULL AND a.talkroute_number <> '';

  SELECT count(*) INTO v_eligible_leads FROM public.leads WHERE status = 'new';

  IF v_selected_count = 0 THEN v_blocking := v_blocking || 'No agents available (must be active, available, transfer-certified with valid phone numbers). '; END IF;
  IF v_eligible_leads = 0 THEN v_blocking := v_blocking || 'No leads uploaded. '; END IF;
  IF v_campaign.state = 'running' THEN v_blocking := v_blocking || 'Campaign already running. '; END IF;

  IF v_blocking <> '' THEN
    UPDATE public.campaigns SET blocking_reason = v_blocking, updated_at = now() WHERE id = v_campaign.id;
    RETURN jsonb_build_object('success', false, 'error', 'Campaign cannot start', 'blocking_reason', v_blocking);
  END IF;

  UPDATE public.campaigns
  SET state = 'running', dialer_activated = true, concurrency = p_concurrency,
      provider_call_limit = p_call_limit, started_at = now(), blocking_reason = '', updated_at = now()
  WHERE id = v_campaign.id;

  INSERT INTO public.campaign_events (campaign_id, event_type, event_data)
  VALUES (v_campaign.id, 'campaign_start', jsonb_build_object('concurrency', p_concurrency, 'call_limit', p_call_limit, 'stale_cleaned', v_cleaned_count));

  RETURN jsonb_build_object('success', true, 'message', 'Campaign started', 'stale_cleaned', v_cleaned_count);
END;
$function$;
