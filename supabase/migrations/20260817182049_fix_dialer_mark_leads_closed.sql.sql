-- Fix dialer_next_batch: 
-- 1. The reset-in_progress logic was setting leads back to 'new' when their call
--    was no longer pending. But those leads already have a call record, so the
--    NOT EXISTS check would skip them anyway. The problem is that the reset could
--    fire AFTER the auto-clean completed the call, creating a window where the
--    lead is 'new' but has a completed call — the dialer skips it (correct) but
--    the lead stays 'new' forever, clogging the queue.
-- 2. Fix: set leads to 'closed' (not 'new') when their call is no longer pending.
-- 3. Also: after auto-cleaning stale pending calls, mark their leads as 'closed'
--    so they don't get re-selected.
-- 4. Increase auto-clean timeout from 10 to 5 minutes since Bland calls usually
--    complete within 2-3 minutes.

CREATE OR REPLACE FUNCTION public.dialer_next_batch()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_campaign record;
  v_remaining integer;
  v_calls_today integer;
  v_results jsonb[] := ARRAY[]::jsonb[];
  v_lead record;
  v_call_id uuid;
  v_agent record;
  v_agent_remaining integer;
BEGIN
  SELECT * INTO v_campaign FROM public.campaigns ORDER BY created_at DESC LIMIT 1;
  IF v_campaign.state <> 'running' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Campaign is not running');
  END IF;

  -- Auto-clean stale pending calls older than 5 minutes
  -- and mark their leads as 'closed' so they don't get re-selected
  UPDATE public.calls
  SET is_completed = true,
      agent_notes = COALESCE(agent_notes, '') || ' [Auto-cleaned: stale pending]'
  WHERE queue = 'pending' AND is_completed = false AND created_at < now() - interval '5 minutes';

  -- Mark leads as 'closed' for auto-cleaned calls
  UPDATE public.leads
  SET status = 'closed'
  WHERE status = 'in_progress'
  AND id IN (
    SELECT DISTINCT c.lead_id FROM public.calls c
    WHERE c.queue <> 'pending' AND c.lead_id IS NOT NULL
  );

  -- Also mark leads as 'closed' if their phone has any completed call
  UPDATE public.leads
  SET status = 'closed'
  WHERE status = 'in_progress'
  AND telephone_normalized <> ''
  AND EXISTS (
    SELECT 1 FROM public.calls c
    WHERE c.consumer_phone = leads.telephone_normalized
    AND c.call_direction = 'outbound'
    AND c.is_completed = true
  );

  -- Total calls made this campaign
  SELECT count(*) INTO v_calls_today FROM public.calls
  WHERE created_at >= v_campaign.started_at AND call_direction = 'outbound';

  v_remaining := v_campaign.provider_call_limit - v_calls_today;
  IF v_remaining <= 0 THEN
    RETURN jsonb_build_object('success', true, 'calls_to_dial', 0, 'message', 'Call limit reached');
  END IF;

  -- Loop over ALL selected, ready agents
  FOR v_agent IN
    SELECT * FROM public.agents
    WHERE active_for_dialer = true AND status = 'active' AND logged_in = true
    AND bland_number <> '' AND talkroute_number <> ''
    AND transfer_certified = true AND is_owner = false
  LOOP
    v_agent_remaining := LEAST(v_agent.dialer_concurrency, v_remaining);
    IF v_agent_remaining <= 0 THEN EXIT; END IF;

    FOR v_lead IN
      SELECT l.id, l.name, l.telephone_original, l.telephone_normalized,
             l.address, l.income_range, l.home_value, l.property_information,
             l.notes, l.source, l.custom_fields
      FROM public.leads l
      WHERE l.status = 'new'
      AND l.telephone_normalized <> ''
      -- Skip ANY lead whose phone number has ANY outbound call record.
      AND NOT EXISTS (
        SELECT 1 FROM public.calls c
        WHERE c.consumer_phone = l.telephone_normalized
        AND c.call_direction = 'outbound'
      )
      ORDER BY l.created_at ASC
      LIMIT v_agent_remaining
    LOOP
      UPDATE public.leads SET status = 'in_progress' WHERE id = v_lead.id;

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
        'call_id', v_call_id,
        'lead_id', v_lead.id,
        'phone', v_lead.telephone_normalized,
        'name', v_lead.name,
        'agent_id', v_agent.id,
        'agent_name', v_agent.full_name,
        'bland_number', v_agent.bland_number,
        'bland_phone_id', v_agent.bland_phone_id,
        'bland_voice_id', v_agent.bland_voice_id,
        'talkroute_number', v_agent.talkroute_number
      ));

      v_remaining := v_remaining - 1;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'calls_to_dial', jsonb_array_length(to_jsonb(v_results)),
    'calls', to_jsonb(v_results)
  );
END;
$function$;
