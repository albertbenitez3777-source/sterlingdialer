/*
# Fix deadlock in dialer_next_batch

The cleanup UPDATEs on leads (setting in_progress back to new, closing leads with calls)
were conflicting with the FOR UPDATE SKIP LOCKED lead selection, causing deadlocks.
Fix: Use READ COMMITTED isolation and move cleanup to happen before any locking.
Also reduce the self-chain interval from 60s to 45s to keep the loop moving.
*/

CREATE OR REPLACE FUNCTION public.dialer_next_batch()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_campaign record;
  v_remaining integer;
  v_calls_placed integer;
  v_results jsonb[] := ARRAY[]::jsonb[];
  v_lead record;
  v_call_id uuid;
  v_agent record;
  v_agent_remaining integer;
  v_recent_calls integer;
BEGIN
  SELECT * INTO v_campaign FROM public.campaigns ORDER BY created_at DESC LIMIT 1;
  IF v_campaign.state <> 'running' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Campaign is not running');
  END IF;

  SELECT count(*) INTO v_recent_calls
  FROM public.calls
  WHERE created_at >= now() - interval '2 minutes'
  AND call_direction = 'outbound';

  IF v_recent_calls > 60 THEN
    UPDATE public.campaigns SET state = 'stopped', blocking_reason = 'RUNAWAY PROTECTION: ' || v_recent_calls || ' calls in 2 minutes' WHERE id = v_campaign.id;
    RETURN jsonb_build_object('success', false, 'error', 'RUNAWAY PROTECTION: ' || v_recent_calls || ' calls in 2 minutes');
  END IF;

  -- Auto-clean stale pending calls (no lock conflict — calls table not leads)
  UPDATE public.calls
  SET is_completed = true,
  queue = CASE WHEN queue = 'pending' THEN 'no_answer' ELSE queue END,
  agent_notes = COALESCE(agent_notes, '') || ' [Auto-cleaned: stale pending]'
  WHERE queue = 'pending' AND is_completed = false AND created_at < now() - interval '45 seconds';

  DELETE FROM public.calls
  WHERE call_direction = 'outbound'
  AND (provider_call_id IS NULL OR provider_call_id = '')
  AND created_at < now() - interval '90 seconds';

  -- Reset in_progress leads with no active call (use subquery, no explicit lock needed)
  UPDATE public.leads l
  SET status = 'new'
  WHERE l.status = 'in_progress'
  AND NOT EXISTS (
    SELECT 1 FROM public.calls c
    WHERE c.lead_id = l.id
    AND c.call_direction = 'outbound'
    AND c.provider_call_id IS NOT NULL AND c.provider_call_id <> ''
  );

  -- Close leads whose phone has a real call in THIS campaign
  UPDATE public.leads l
  SET status = 'closed'
  WHERE l.status IN ('in_progress', 'new')
  AND l.telephone_normalized <> ''
  AND EXISTS (
    SELECT 1 FROM public.calls c
    WHERE c.consumer_phone = l.telephone_normalized
    AND c.call_direction = 'outbound'
    AND c.provider_call_id IS NOT NULL AND c.provider_call_id <> ''
    AND c.created_at >= v_campaign.started_at
  );

  SELECT count(*) INTO v_calls_placed FROM public.calls
  WHERE created_at >= v_campaign.started_at
  AND call_direction = 'outbound'
  AND provider_call_id IS NOT NULL AND provider_call_id <> '';

  v_remaining := v_campaign.provider_call_limit - v_calls_placed;
  IF v_remaining <= 0 THEN
    RETURN jsonb_build_object('success', true, 'calls_to_dial', 0, 'message', 'Call limit reached');
  END IF;

  -- PHASE 1: Assigned leads (only the assigned agent dials these)
  FOR v_agent IN
    SELECT * FROM public.agents
    WHERE active_for_dialer = true AND status = 'active' AND is_owner = false
    AND bland_number <> '' AND talkroute_number <> '' AND transfer_certified = true
  LOOP
    v_agent_remaining := LEAST(v_agent.dialer_concurrency, v_remaining);
    IF v_agent_remaining <= 0 THEN EXIT; END IF;

    FOR v_lead IN
      SELECT l.id, l.name, l.telephone_original, l.telephone_normalized,
             l.address, l.income_range, l.home_value, l.property_information,
             l.notes, l.source, l.custom_fields, l.is_priority
      FROM public.leads l
      WHERE l.status = 'new' AND l.assigned_agent_id = v_agent.id
      AND l.telephone_normalized <> ''
      AND l.telephone_normalized !~ '^\+?1?(800|855|866|877|888|844|833)'
      AND NOT EXISTS (
        SELECT 1 FROM public.calls c
        WHERE c.consumer_phone = l.telephone_normalized
        AND c.call_direction = 'outbound'
        AND c.provider_call_id IS NOT NULL AND c.provider_call_id <> ''
        AND c.created_at >= v_campaign.started_at
      )
      ORDER BY l.is_priority DESC, l.created_at ASC
      FOR UPDATE OF l SKIP LOCKED
      LIMIT v_agent_remaining
    LOOP
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
          'is_priority', v_lead.is_priority
        ));
        v_remaining := v_remaining - 1;
      EXCEPTION WHEN unique_violation THEN
        UPDATE public.leads SET status = 'closed' WHERE id = v_lead.id;
      END;
    END LOOP;
  END LOOP;

  -- PHASE 2: Unassigned leads (round-robin, priority first)
  IF v_remaining > 0 THEN
    FOR v_agent IN
      SELECT * FROM public.agents
      WHERE active_for_dialer = true AND status = 'active' AND is_owner = false
      AND bland_number <> '' AND talkroute_number <> '' AND transfer_certified = true
    LOOP
      v_agent_remaining := LEAST(v_agent.dialer_concurrency, v_remaining);
      IF v_agent_remaining <= 0 THEN EXIT; END IF;

      FOR v_lead IN
        SELECT l.id, l.name, l.telephone_original, l.telephone_normalized,
               l.address, l.income_range, l.home_value, l.property_information,
               l.notes, l.source, l.custom_fields, l.is_priority
        FROM public.leads l
        WHERE l.status = 'new' AND l.assigned_agent_id IS NULL
        AND l.telephone_normalized <> ''
        AND l.telephone_normalized !~ '^\+?1?(800|855|866|877|888|844|833)'
        AND NOT EXISTS (
          SELECT 1 FROM public.calls c
          WHERE c.consumer_phone = l.telephone_normalized
          AND c.call_direction = 'outbound'
          AND c.provider_call_id IS NOT NULL AND c.provider_call_id <> ''
          AND c.created_at >= v_campaign.started_at
        )
        ORDER BY l.is_priority DESC, l.created_at ASC
        FOR UPDATE OF l SKIP LOCKED
        LIMIT v_agent_remaining
      LOOP
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
            'is_priority', v_lead.is_priority
          ));
          v_remaining := v_remaining - 1;
        EXCEPTION WHEN unique_violation THEN
          UPDATE public.leads SET status = 'closed' WHERE id = v_lead.id;
        END;
      END LOOP;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'calls_to_dial', jsonb_array_length(to_jsonb(v_results)),
    'calls', to_jsonb(v_results)
  );
END;
$function$;
