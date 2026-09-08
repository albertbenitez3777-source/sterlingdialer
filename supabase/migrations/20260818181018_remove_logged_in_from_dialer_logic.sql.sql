/*
# Remove logged_in and available_for_transfer from all dialer logic
#
# The ONLY runtime activation requirement for outbound calls is active_for_dialer = true.
# logged_in remains a display-only field (whether the agent is using the app).
# available_for_transfer remains informational only.
#
# This migration replaces:
# 1. dialer_next_batch() — remove logged_in = true from agent selection
# 2. campaign_start() — remove logged_in = true from eligible-agent count
# 3. set_agent_dialer_selection() — do NOT set logged_in or available_for_transfer
# 4. get_admin_stats() — agents_dialing count no longer requires logged_in
# 5. get_agent_readiness_table() — keep displaying logged_in/available_for_transfer but they are informational
*/

-- ════════════════════════════════════════════════════════════════════════
-- 1. dialer_next_batch() — agent selection uses ONLY active_for_dialer
-- ════════════════════════════════════════════════════════════════════════
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
  v_phone_already_called boolean;
BEGIN
  SELECT * INTO v_campaign FROM public.campaigns ORDER BY created_at DESC LIMIT 1;
  IF v_campaign.state <> 'running' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Campaign is not running');
  END IF;

  -- Auto-clean stale pending calls older than 10 minutes
  UPDATE public.calls
  SET is_completed = true,
      queue = CASE WHEN queue = 'pending' THEN 'no_answer' ELSE queue END,
      agent_notes = COALESCE(agent_notes, '') || ' [Auto-cleaned: stale pending]'
  WHERE queue = 'pending' AND is_completed = false AND created_at < now() - interval '10 minutes';

  -- Delete failed call records (never reached Bland) so leads can be retried
  DELETE FROM public.calls
  WHERE call_direction = 'outbound'
    AND (provider_call_id IS NULL OR provider_call_id = '');

  -- Reset leads that had failed calls back to 'new' so they get retried
  UPDATE public.leads
  SET status = 'new'
  WHERE status = 'in_progress'
    AND NOT EXISTS (
      SELECT 1 FROM public.calls c
      WHERE c.lead_id = leads.id
        AND c.call_direction = 'outbound'
    );

  -- Mark leads as 'closed' if their phone has a completed call with a real provider_call_id
  UPDATE public.leads
  SET status = 'closed'
  WHERE status = 'in_progress'
    AND telephone_normalized <> ''
    AND EXISTS (
      SELECT 1 FROM public.calls c
      WHERE c.consumer_phone = leads.telephone_normalized
        AND c.call_direction = 'outbound'
        AND c.provider_call_id IS NOT NULL AND c.provider_call_id <> ''
    );

  -- Count only successfully placed calls toward the limit
  SELECT count(*) INTO v_calls_placed FROM public.calls
  WHERE created_at >= v_campaign.started_at
    AND call_direction = 'outbound'
    AND provider_call_id IS NOT NULL AND provider_call_id <> '';

  v_remaining := v_campaign.provider_call_limit - v_calls_placed;
  IF v_remaining <= 0 THEN
    RETURN jsonb_build_object('success', true, 'calls_to_dial', 0, 'message', 'Call limit reached');
  END IF;

  -- Loop over ALL agents with active_for_dialer = true and status = 'active'
  -- NO logged_in or available_for_transfer requirement.
  -- Requires: valid Bland number, valid Talkroute number, transfer_certified.
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
          WHERE c.consumer_phone = l.telephone_normalized
            AND c.call_direction = 'outbound'
            AND c.provider_call_id IS NOT NULL AND c.provider_call_id <> ''
        )
      ORDER BY l.created_at ASC
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

REVOKE ALL ON FUNCTION public.dialer_next_batch() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dialer_next_batch() TO authenticated, anon;

-- ════════════════════════════════════════════════════════════════════════
-- 2. campaign_start() — eligible agents no longer need logged_in = true
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.campaign_start(p_concurrency integer DEFAULT 3, p_call_limit integer DEFAULT 50)
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

  -- Count agents that are eligible for dialing:
  -- active_for_dialer = true, status = 'active', valid numbers, transfer_certified
  -- NO logged_in or available_for_transfer requirement.
  SELECT count(*) INTO v_selected_count FROM public.agents
  WHERE active_for_dialer = true
    AND status = 'active'
    AND bland_number <> ''
    AND talkroute_number <> ''
    AND transfer_certified = true
    AND is_owner = false;

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
$function$;

REVOKE ALL ON FUNCTION public.campaign_start(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.campaign_start(integer, integer) TO authenticated, anon;

-- ════════════════════════════════════════════════════════════════════════
-- 3. set_agent_dialer_selection() — ONLY sets active_for_dialer
-- Does NOT touch logged_in or available_for_transfer.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.set_agent_dialer_selection(p_agent_id uuid, p_selected boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_selected THEN
    -- Only set active_for_dialer. Do NOT change logged_in or available_for_transfer.
    -- Those fields reflect the agent's real app-usage status, not dialer activation.
    UPDATE public.agents
    SET active_for_dialer = true,
        last_seen_at = now()
    WHERE id = p_agent_id AND is_owner = false;
  ELSE
    -- Deactivate from dialer. Do NOT change logged_in or available_for_transfer.
    -- In-flight calls continue; only new calls are stopped.
    UPDATE public.agents
    SET active_for_dialer = false
    WHERE id = p_agent_id AND is_owner = false;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Agent not found or is owner');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_agent_dialer_selection(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_agent_dialer_selection(uuid, boolean) TO authenticated, anon;

-- ════════════════════════════════════════════════════════════════════════
-- 4. get_admin_stats() — agents_dialing no longer requires logged_in
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_admin_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_summary jsonb;
  v_agents jsonb;
  v_agent record;
  v_durations jsonb;
  v_stats jsonb;
  v_agents_list jsonb[];
  v_campaign record;
  v_leads_remaining integer;
  v_agents_selected integer;
  v_agents_dialing integer;
BEGIN
  SELECT * INTO v_campaign FROM public.campaigns ORDER BY created_at DESC LIMIT 1;
  SELECT count(*) INTO v_leads_remaining FROM public.leads WHERE status IN ('new', 'pending');
  SELECT count(*) INTO v_agents_selected FROM public.agents WHERE active_for_dialer = true AND status = 'active' AND is_owner = false;
  -- agents_dialing = agents with active_for_dialer = true (no logged_in requirement)
  SELECT count(*) INTO v_agents_dialing FROM public.agents WHERE active_for_dialer = true AND status = 'active' AND is_owner = false;

  SELECT jsonb_build_object(
    'agents_logged_in', (SELECT count(*) FROM public.agents WHERE logged_in = true AND is_owner = false AND status <> 'archived'),
    'agents_available', (SELECT count(*) FROM public.agents WHERE available_for_transfer = true AND is_owner = false AND status <> 'archived'),
    'agents_selected_for_dialer', v_agents_selected,
    'agents_dialing', v_agents_dialing,
    'leads_remaining', v_leads_remaining,
    'live_humans_today', (SELECT count(*) FROM public.calls WHERE is_live_human = true AND created_at >= date_trunc('day', now())),
    'human_drops_today', (SELECT count(*) FROM public.calls WHERE queue = 'human_drop' AND created_at >= date_trunc('day', now())),
    'fire_transfers_today', (SELECT count(*) FROM public.calls WHERE queue = 'fire_transfer' AND created_at >= date_trunc('day', now())),
    'failed_transfers_today', (SELECT count(*) FROM public.calls WHERE queue = 'human_drop' AND transfer_failure_reason <> '' AND created_at >= date_trunc('day', now())),
    'voice_messages_today', (SELECT count(*) FROM public.calls WHERE queue = 'voice_message' AND created_at >= date_trunc('day', now())),
    'calls_attempted_today', (SELECT count(*) FROM public.calls WHERE call_direction = 'outbound' AND created_at >= date_trunc('day', now())),
    'provider_accepted_today', (SELECT count(*) FROM public.calls WHERE talkroute_leg_created = true AND created_at >= date_trunc('day', now())),
    'transfer_requests_today', (SELECT count(*) FROM public.calls WHERE human_agreed_transfer = true AND created_at >= date_trunc('day', now())),
    'talkroute_answers_today', (SELECT count(*) FROM public.calls WHERE talkroute_answered = true AND created_at >= date_trunc('day', now())),
    'dnc_requests_today', (SELECT count(*) FROM public.calls WHERE is_dnc = true AND created_at >= date_trunc('day', now())),
    'callbacks_today', (SELECT count(*) FROM public.calls WHERE callback_requested = true AND created_at >= date_trunc('day', now())),
    'total_login_hours_today', (
      SELECT COALESCE(sum(extract(epoch FROM (
        LEAST(COALESCE(invalidated_at, now()), date_trunc('day', now()) + interval '1 day')
        - GREATEST(created_at, date_trunc('day', now()))
      ))), 0) / 3600
      FROM public.auth_sessions
      WHERE created_at < date_trunc('day', now()) + interval '1 day'
        AND COALESCE(invalidated_at, now()) > date_trunc('day', now())
    ),
    'campaign_state', COALESCE(v_campaign.state, 'stopped'),
    'dialer_activated', COALESCE(v_campaign.dialer_activated, false),
    'concurrency', COALESCE(v_campaign.concurrency, 3),
    'provider_call_limit', COALESCE(v_campaign.provider_call_limit, 0),
    'provider_accepted_completed', COALESCE(v_campaign.provider_accepted_completed, 0),
    'active_calls', COALESCE(v_campaign.active_calls, 0),
    'campaign_started_at', v_campaign.started_at,
    'last_provider_event', v_campaign.last_provider_event,
    'blocking_reason', CASE WHEN COALESCE(v_campaign.state, 'stopped') = 'stopped' THEN '' ELSE COALESCE(v_campaign.blocking_reason, '') END
  ) INTO v_summary;

  v_agents_list := ARRAY[]::jsonb[];
  FOR v_agent IN SELECT * FROM public.agents WHERE is_owner = false ORDER BY created_at LOOP
    SELECT public.get_agent_session_durations(v_agent.id) INTO v_durations;
    SELECT jsonb_build_object(
      'id', v_agent.id,
      'full_name', v_agent.full_name,
      'role', v_agent.role,
      'status', v_agent.status,
      'logged_in', v_agent.logged_in,
      'available', v_agent.available_for_transfer,
      'active_for_dialer', v_agent.active_for_dialer,
      'dialer_concurrency', v_agent.dialer_concurrency,
      'visible_in_admin', v_agent.visible_in_admin,
      'bland_number', v_agent.bland_number,
      'talkroute_number', v_agent.talkroute_number,
      'talkroute_extension', v_agent.talkroute_extension,
      'bland_voice_id', v_agent.bland_voice_id,
      'bland_verified', v_agent.bland_verified,
      'talkroute_verified', v_agent.talkroute_verified,
      'transfer_certified', v_agent.transfer_certified,
      'provider_sync_status', v_agent.provider_sync_status,
      'bland_number_owned_active', v_agent.bland_number_owned_active,
      'mapping_notes', v_agent.mapping_notes,
      'exact_blocker', v_agent.exact_blocker,
      'secretary_persona', v_agent.secretary_persona,
      'outbound_attempts_today', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND call_direction = 'outbound' AND created_at >= date_trunc('day', now())),
      'live_humans', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND is_live_human = true AND created_at >= date_trunc('day', now())),
      'human_drops', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'human_drop' AND created_at >= date_trunc('day', now())),
      'fire_transfers', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'fire_transfer' AND created_at >= date_trunc('day', now())),
      'last_call_time', (SELECT max(created_at) FROM public.calls WHERE agent_id = v_agent.id)
    ) INTO v_stats;
    v_stats := v_stats || v_durations;
    v_agents_list := array_append(v_agents_list, v_stats);
  END LOOP;

  v_agents := COALESCE(jsonb_agg(v), '[]'::jsonb) FROM unnest(v_agents_list) v;
  RETURN jsonb_build_object('summary', v_summary, 'agents', v_agents);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_admin_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_stats() TO authenticated, anon;