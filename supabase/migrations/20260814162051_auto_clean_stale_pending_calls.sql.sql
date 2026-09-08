-- Auto-clean stale pending calls before campaign_start and dialer_next_batch
-- so the dialer never gets stuck blocking on calls that failed to send to Bland.ai

-- Update campaign_start to auto-clean stale pending calls instead of blocking
CREATE OR REPLACE FUNCTION public.campaign_start(
  p_concurrency integer DEFAULT 3,
  p_call_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign record;
  v_selected_count integer;
  v_blocking text := '';
  v_eligible_leads integer;
  v_cleaned_count integer;
BEGIN
  SELECT * INTO v_campaign FROM public.campaigns ORDER BY created_at DESC LIMIT 1;

  -- Auto-clean stale pending calls older than 10 minutes
  UPDATE public.calls
  SET queue = 'human_drop', is_completed = true,
      agent_notes = COALESCE(agent_notes, '') || ' [Auto-cleaned: stale pending]'
  WHERE queue = 'pending' AND created_at < now() - interval '10 minutes';

  GET DIAGNOSTICS v_cleaned_count = ROW_COUNT;

  -- Also reset any in_progress leads whose calls are no longer pending
  UPDATE public.leads
  SET status = 'new'
  WHERE status = 'in_progress'
  AND id IN (
    SELECT DISTINCT c.lead_id FROM public.calls c
    WHERE c.queue <> 'pending' AND c.lead_id IS NOT NULL
  );

  SELECT count(*) INTO v_selected_count FROM public.agents
  WHERE active_for_dialer = true AND status = 'active' AND logged_in = true
  AND bland_number <> '' AND talkroute_number <> '' AND transfer_certified = true AND is_owner = false;

  SELECT count(*) INTO v_eligible_leads FROM public.leads WHERE status IN ('new', 'pending');

  IF v_selected_count = 0 THEN v_blocking := v_blocking || 'No agent selected and ready. '; END IF;
  IF v_eligible_leads = 0 THEN v_blocking := v_blocking || 'No eligible leads. '; END IF;
  IF v_campaign.state = 'running' THEN v_blocking := v_blocking || 'Campaign already running. '; END IF;

  IF v_blocking <> '' THEN
    UPDATE public.campaigns SET blocking_reason = v_blocking, updated_at = now() WHERE id = v_campaign.id;
    RETURN jsonb_build_object('success', false, 'error', 'Campaign cannot start', 'blocking_reason', v_blocking);
  END IF;

  UPDATE public.campaigns SET state = 'running', dialer_activated = true, concurrency = p_concurrency,
  provider_call_limit = p_call_limit, started_at = now(), blocking_reason = '', updated_at = now()
  WHERE id = v_campaign.id;

  INSERT INTO public.campaign_events (campaign_id, event_type, event_data)
  VALUES (v_campaign.id, 'campaign_start', jsonb_build_object('concurrency', p_concurrency, 'call_limit', p_call_limit, 'stale_cleaned', v_cleaned_count));

  RETURN jsonb_build_object('success', true, 'message', 'Campaign started', 'stale_cleaned', v_cleaned_count);
END;
$$;

-- Update dialer_next_batch to auto-clean stale pending calls at the start
CREATE OR REPLACE FUNCTION public.dialer_next_batch()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign record;
  v_remaining integer;
  v_calls_today integer;
  v_results jsonb[] := ARRAY[]::jsonb[];
  v_lead record;
  v_call_id uuid;
  v_agent record;
  v_to_dial integer;
  v_agent_remaining integer;
BEGIN
  SELECT * INTO v_campaign FROM public.campaigns ORDER BY created_at DESC LIMIT 1;
  IF v_campaign.state <> 'running' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Campaign is not running');
  END IF;

  -- Auto-clean stale pending calls older than 10 minutes
  UPDATE public.calls
  SET queue = 'human_drop', is_completed = true,
      agent_notes = COALESCE(agent_notes, '') || ' [Auto-cleaned: stale pending]'
  WHERE queue = 'pending' AND created_at < now() - interval '10 minutes';

  -- Reset in_progress leads back to new if their call is no longer pending
  UPDATE public.leads
  SET status = 'new'
  WHERE status = 'in_progress'
  AND id IN (
    SELECT DISTINCT c.lead_id FROM public.calls c
    WHERE c.queue <> 'pending' AND c.lead_id IS NOT NULL
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
      AND NOT EXISTS (
        SELECT 1 FROM public.calls c
        WHERE c.lead_id = l.id AND c.call_direction = 'outbound'
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
$$;

-- Clear the stale blocking reason
UPDATE public.campaigns SET blocking_reason = '' WHERE state = 'stopped' AND blocking_reason = 'Unresolved stale calls. ';
