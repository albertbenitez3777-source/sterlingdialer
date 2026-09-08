/*
# Simplify campaign_start for 2-agent system
# Remove stale pending call check blocking, simplify eligibility
*/
CREATE OR REPLACE FUNCTION public.campaign_start(p_concurrency integer DEFAULT 3, p_call_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
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
  SET queue = 'no_answer', is_completed = true,
      agent_notes = COALESCE(agent_notes, '') || ' [Auto-cleaned: stale pending]'
  WHERE queue = 'pending' AND created_at < now() - interval '10 minutes';

  GET DIAGNOSTICS v_cleaned_count = ROW_COUNT;

  -- Reset any in_progress leads whose calls are no longer pending
  UPDATE public.leads
  SET status = 'new'
  WHERE status = 'in_progress'
    AND id IN (
      SELECT DISTINCT c.lead_id FROM public.calls c
      WHERE c.queue <> 'pending' AND c.lead_id IS NOT NULL
    );

  -- Count agents ready for dialing
  SELECT count(*) INTO v_selected_count FROM public.agents
  WHERE active_for_dialer = true
    AND status = 'active'
    AND bland_number <> ''
    AND talkroute_number <> ''
    AND transfer_certified = true
    AND is_owner = false;

  SELECT count(*) INTO v_eligible_leads FROM public.leads WHERE status = 'new';

  IF v_selected_count = 0 THEN v_blocking := v_blocking || 'No agents activated. '; END IF;
  IF v_eligible_leads = 0 THEN v_blocking := v_blocking || 'No leads uploaded. '; END IF;
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
$function$;

REVOKE ALL ON FUNCTION public.campaign_start(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.campaign_start(integer, integer) TO authenticated, anon;

-- Update set_agent_concurrency to allow setting 3, 5, or 7 lines
CREATE OR REPLACE FUNCTION public.set_agent_concurrency(p_agent_id uuid, p_concurrency integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
BEGIN
  IF p_concurrency NOT IN (1, 2, 3, 4, 5, 6, 7) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Concurrency must be between 1 and 7');
  END IF;
  
  UPDATE public.agents
  SET dialer_concurrency = p_concurrency
  WHERE id = p_agent_id AND is_owner = false;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Agent not found or is owner');
  END IF;

  RETURN jsonb_build_object('success', true, 'concurrency', p_concurrency);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_agent_concurrency(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_agent_concurrency(uuid, integer) TO authenticated, anon;
