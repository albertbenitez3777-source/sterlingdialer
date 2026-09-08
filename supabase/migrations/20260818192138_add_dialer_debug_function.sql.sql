CREATE OR REPLACE FUNCTION public.dialer_next_batch_debug()
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
  v_phone_already_called boolean;
  v_eligible_leads integer;
  v_debug jsonb[] := ARRAY[]::jsonb[];
BEGIN
  SELECT * INTO v_campaign FROM public.campaigns ORDER BY created_at DESC LIMIT 1;
  
  v_debug := array_append(v_debug, jsonb_build_object('step', 'campaign', 'state', v_campaign.state, 'started_at', v_campaign.started_at, 'call_limit', v_campaign.provider_call_limit));

  IF v_campaign.state <> 'running' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Campaign is not running', 'debug', to_jsonb(v_debug));
  END IF;

  -- Delete failed call records
  DELETE FROM public.calls
  WHERE call_direction = 'outbound'
    AND (provider_call_id IS NULL OR provider_call_id = '');

  -- Reset in_progress leads with no real calls
  UPDATE public.leads
  SET status = 'new'
  WHERE status = 'in_progress'
    AND NOT EXISTS (
      SELECT 1 FROM public.calls c
      WHERE c.lead_id = leads.id
        AND c.call_direction = 'outbound'
        AND c.provider_call_id IS NOT NULL AND c.provider_call_id <> ''
    );

  -- Mark closed
  UPDATE public.leads
  SET status = 'closed'
  WHERE status = 'in_progress'
    AND telephone_normalized <> ''
    AND EXISTS (
      SELECT 1 FROM public.calls c
      WHERE c.consumer_phone = leads.telephone_normalized
        AND c.call_direction = 'outbound'
        AND c.provider_call_id IS NOT NULL AND c.provider_call_id <> ''
        AND c.created_at >= v_campaign.started_at
    );

  SELECT count(*) INTO v_calls_placed FROM public.calls
  WHERE created_at >= v_campaign.started_at
    AND call_direction = 'outbound'
    AND provider_call_id IS NOT NULL AND provider_call_id <> '';

  v_remaining := v_campaign.provider_call_limit - v_calls_placed;
  v_debug := array_append(v_debug, jsonb_build_object('step', 'counts', 'calls_placed', v_calls_placed, 'remaining', v_remaining));

  IF v_remaining <= 0 THEN
    RETURN jsonb_build_object('success', true, 'calls_to_dial', 0, 'message', 'Call limit reached', 'debug', to_jsonb(v_debug));
  END IF;

  -- Check agents
  FOR v_agent IN
    SELECT * FROM public.agents
    WHERE active_for_dialer = true
      AND status = 'active'
      AND is_owner = false
      AND bland_number <> ''
      AND talkroute_number <> ''
      AND transfer_certified = true
  LOOP
    v_agent_remaining := LEAST(v_agent.dialer_concurrency, v_remaining);
    v_debug := array_append(v_debug, jsonb_build_object('step', 'agent', 'name', v_agent.full_name, 'concurrency', v_agent.dialer_concurrency, 'agent_remaining', v_agent_remaining));

    IF v_agent_remaining <= 0 THEN EXIT; END IF;

    -- Count eligible leads
    SELECT count(*) INTO v_eligible_leads FROM public.leads l
    WHERE l.status = 'new'
      AND l.telephone_normalized <> ''
      AND NOT EXISTS (
        SELECT 1 FROM public.calls c
        WHERE c.consumer_phone = l.telephone_normalized
          AND c.call_direction = 'outbound'
          AND c.provider_call_id IS NOT NULL AND c.provider_call_id <> ''
          AND c.created_at >= v_campaign.started_at
      );
    v_debug := array_append(v_debug, jsonb_build_object('step', 'eligible_leads', 'count', v_eligible_leads));

    FOR v_lead IN
      SELECT l.id, l.name, l.telephone_original, l.telephone_normalized,
             l.address, l.income_range, l.home_value, l.property_information,
             l.notes, l.source, l.custom_fields
      FROM public.leads l
      WHERE l.status = 'new'
        AND l.telephone_normalized <> ''
        AND NOT EXISTS (
          SELECT 1 FROM public.calls c
          WHERE c.consumer_phone = l.telephone_normalized
            AND c.call_direction = 'outbound'
            AND c.provider_call_id IS NOT NULL AND c.provider_call_id <> ''
            AND c.created_at >= v_campaign.started_at
        )
      ORDER BY l.created_at ASC
      FOR UPDATE OF l SKIP LOCKED
      LIMIT v_agent_remaining
    LOOP
      v_debug := array_append(v_debug, jsonb_build_object('step', 'lead_found', 'name', v_lead.name, 'phone', v_lead.telephone_normalized));

      SELECT EXISTS(
        SELECT 1 FROM public.calls c
        WHERE c.consumer_phone = v_lead.telephone_normalized
          AND c.call_direction = 'outbound'
          AND c.provider_call_id IS NOT NULL AND c.provider_call_id <> ''
          AND c.created_at >= v_campaign.started_at
      ) INTO v_phone_already_called;

      IF v_phone_already_called THEN
        UPDATE public.leads SET status = 'closed' WHERE id = v_lead.id;
        v_debug := array_append(v_debug, jsonb_build_object('step', 'skip', 'reason', 'already_called'));
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
        v_debug := array_append(v_debug, jsonb_build_object('step', 'inserted', 'call_id', v_call_id));
      EXCEPTION WHEN unique_violation THEN
        UPDATE public.leads SET status = 'closed' WHERE id = v_lead.id;
        v_debug := array_append(v_debug, jsonb_build_object('step', 'exception', 'error', 'unique_violation'));
      END;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'calls_to_dial', jsonb_array_length(to_jsonb(v_results)),
    'calls', to_jsonb(v_results),
    'debug', to_jsonb(v_debug)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.dialer_next_batch_debug() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dialer_next_batch_debug() TO authenticated, anon;