-- Remove the available_for_transfer requirement from the dialer batch function.
-- Transfers go directly to the agent's Talkroute number via Bland.ai bridging,
-- so the agent does not need to be marked "available" to receive calls.

CREATE OR REPLACE FUNCTION public.dialer_next_batch()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign record;
  v_agent record;
  v_remaining integer;
  v_to_dial integer;
  v_calls_today integer;
  v_results jsonb[] := ARRAY[]::jsonb[];
  v_lead record;
  v_call_id uuid;
BEGIN
  -- Get the active campaign
  SELECT * INTO v_campaign FROM public.campaigns ORDER BY created_at DESC LIMIT 1;
  IF v_campaign.state <> 'running' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Campaign is not running');
  END IF;

  -- Get the single selected, ready agent
  -- Agent must be active, logged in, and fully verified — but does NOT need
  -- available_for_transfer = true, since Bland.ai bridges directly to Talkroute.
  SELECT * INTO v_agent FROM public.agents
  WHERE active_for_dialer = true AND status = 'active' AND logged_in = true
    AND bland_number <> '' AND talkroute_number <> ''
    AND transfer_certified = true AND is_owner = false
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No ready agent selected');
  END IF;

  -- How many calls have we already made this campaign?
  SELECT count(*) INTO v_calls_today FROM public.calls
  WHERE created_at >= v_campaign.started_at AND call_direction = 'outbound';

  -- How many more can we dial based on the call limit?
  v_remaining := v_campaign.provider_call_limit - v_calls_today;
  IF v_remaining <= 0 THEN
    RETURN jsonb_build_object('success', true, 'calls_to_dial', 0, 'message', 'Call limit reached');
  END IF;

  -- Dial up to concurrency or remaining, whichever is smaller
  v_to_dial := LEAST(v_campaign.concurrency, v_remaining);

  -- Pick leads that are 'new', not yet called, and have a valid phone
  FOR v_lead IN
    SELECT l.id, l.name, l.telephone_original, l.telephone_normalized,
           l.address, l.income_range, l.home_value, l.property_information,
           l.notes, l.source, l.custom_fields
    FROM public.leads l
    WHERE l.status = 'new'
      AND l.telephone_normalized <> ''
      AND NOT EXISTS (
        SELECT 1 FROM public.calls c
        WHERE c.lead_id = l.id AND c.call_direction = 'outbound'
      )
    ORDER BY l.created_at ASC
    LIMIT v_to_dial
  LOOP
    -- Mark lead as in_progress
    UPDATE public.leads SET status = 'in_progress' WHERE id = v_lead.id;

    -- Create the call record
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
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'calls_to_dial', jsonb_array_length(to_jsonb(v_results)),
    'calls', to_jsonb(v_results)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.dialer_next_batch FROM anon;
GRANT EXECUTE ON FUNCTION public.dialer_next_batch TO authenticated;
