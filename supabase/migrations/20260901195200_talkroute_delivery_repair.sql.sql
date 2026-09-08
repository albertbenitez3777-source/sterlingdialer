-- ═══ TALKROUTE DELIVERY REPAIR ════════════════════════════════════════
-- Fixes: get_admin_stats, dialer_next_batch, campaign_start, count_available_agents
-- Does NOT rewrite already-applied migration history.

-- ── 1. count_available_agents — add transfer_certified, bland_number, talkroute_number ──
CREATE OR REPLACE FUNCTION public.count_available_agents()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::integer
  FROM public.agents a
  WHERE a.status = 'active'
    AND a.is_owner = false
    AND a.active_for_dialer = true
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
$$;

-- ── 2. campaign_start — use same predicate as count_available_agents ──
CREATE OR REPLACE FUNCTION public.campaign_start(p_concurrency integer DEFAULT 3, p_call_limit integer DEFAULT 100)
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
    );

  SELECT count(*) INTO v_eligible_leads FROM public.leads WHERE status = 'new';

  IF v_selected_count = 0 THEN v_blocking := v_blocking || 'No agents available (must be logged in, available, transfer-certified, with valid session). '; END IF;
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
$$;

-- ── 3. dialer_next_batch — strict per-agent eligibility predicate ──
CREATE OR REPLACE FUNCTION public.dialer_next_batch()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  UPDATE public.calls
  SET is_completed = true,
      queue = CASE WHEN queue = 'pending' THEN 'no_answer' ELSE queue END,
      agent_notes = COALESCE(agent_notes, '') || ' [Auto-cleaned: stale pending]'
  WHERE queue = 'pending' AND is_completed = false AND created_at < now() - interval '10 minutes';

  DELETE FROM public.calls
  WHERE call_direction = 'outbound'
    AND (provider_call_id IS NULL OR provider_call_id = '');

  UPDATE public.leads
  SET status = 'new'
  WHERE status = 'in_progress'
  AND NOT EXISTS (
    SELECT 1 FROM public.calls c
    WHERE c.lead_id = leads.id
    AND c.call_direction = 'outbound'
    AND c.provider_call_id IS NOT NULL AND c.provider_call_id <> ''
  );

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

  UPDATE public.leads
  SET status = 'closed'
  WHERE status = 'new'
  AND telephone_normalized <> ''
  AND EXISTS (
    SELECT 1 FROM public.calls c
    WHERE c.consumer_phone = leads.telephone_normalized
    AND c.call_direction = 'outbound'
    AND c.provider_call_id IS NOT NULL AND c.provider_call_id <> ''
  );

  SELECT count(*) INTO v_calls_placed FROM public.calls
  WHERE created_at >= v_campaign.started_at
    AND call_direction = 'outbound'
    AND provider_call_id IS NOT NULL AND provider_call_id <> '';

  v_remaining := v_campaign.provider_call_limit - v_calls_placed;
  IF v_remaining <= 0 THEN
    RETURN jsonb_build_object('success', true, 'calls_to_dial', 0, 'message', 'Call limit reached');
  END IF;

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
    ORDER BY a.created_at
  LOOP
    v_agent_remaining := LEAST(v_agent.dialer_concurrency, v_remaining);
    IF v_agent_remaining <= 0 THEN EXIT; END IF;

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
          'talkroute_number', v_agent.talkroute_number,
          'agent_direct_number', v_agent.agent_direct_number
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
$$;

-- ── 4. get_admin_stats — fix column names, add session durations, always return {summary, agents} ──
CREATE OR REPLACE FUNCTION public.get_admin_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_summary jsonb;
  v_agents jsonb;
  v_agents_list jsonb[] := ARRAY[]::jsonb[];
  v_agent record;
  v_stats jsonb;
  v_durations jsonb;
BEGIN
  SELECT jsonb_build_object(
    'campaign_state', COALESCE((SELECT state FROM public.campaigns ORDER BY created_at DESC LIMIT 1), 'idle'),
    'dialer_activated', COALESCE((SELECT dialer_activated FROM public.campaigns ORDER BY created_at DESC LIMIT 1), false),
    'concurrency', COALESCE((SELECT concurrency FROM public.campaigns ORDER BY created_at DESC LIMIT 1), 1),
    'provider_call_limit', COALESCE((SELECT provider_call_limit FROM public.campaigns ORDER BY created_at DESC LIMIT 1), 100),
    'leads_remaining', (SELECT count(*) FROM public.leads WHERE status = 'new'),
    'calls_attempted_today', (SELECT count(*) FROM public.calls WHERE call_direction = 'outbound' AND created_at >= date_trunc('day', now())),
    'live_humans_today', (SELECT count(*) FROM public.calls WHERE is_live_human = true AND created_at >= date_trunc('day', now())),
    'human_drops_today', (SELECT count(*) FROM public.calls WHERE queue = 'human_drop' AND created_at >= date_trunc('day', now())),
    'fire_transfers_today', (SELECT count(*) FROM public.calls WHERE queue = 'fire_transfer' AND created_at >= date_trunc('day', now())),
    'no_answers_today', (SELECT count(*) FROM public.calls WHERE queue = 'no_answer' AND created_at >= date_trunc('day', now())),
    'voice_messages_today', (SELECT count(*) FROM public.calls WHERE queue = 'voice_message' AND created_at >= date_trunc('day', now())),
    'blocking_reason', COALESCE((SELECT blocking_reason FROM public.campaigns ORDER BY created_at DESC LIMIT 1), ''),
    'campaign_started_at', (SELECT started_at FROM public.campaigns ORDER BY created_at DESC LIMIT 1),
    'calls_attempted_week', (SELECT count(*) FROM public.calls WHERE call_direction = 'outbound' AND created_at >= date_trunc('week', now())),
    'live_humans_week', (SELECT count(*) FROM public.calls WHERE is_live_human = true AND created_at >= date_trunc('week', now())),
    'human_drops_week', (SELECT count(*) FROM public.calls WHERE queue = 'human_drop' AND created_at >= date_trunc('week', now())),
    'fire_transfers_week', (SELECT count(*) FROM public.calls WHERE queue = 'fire_transfer' AND created_at >= date_trunc('week', now())),
    'no_answers_week', (SELECT count(*) FROM public.calls WHERE queue = 'no_answer' AND created_at >= date_trunc('week', now())),
    'voice_messages_week', (SELECT count(*) FROM public.calls WHERE queue = 'voice_message' AND created_at >= date_trunc('week', now())),
    'dialer_status', COALESCE((SELECT dialer_status FROM public.campaigns ORDER BY created_at DESC LIMIT 1), 'idle'),
    'agents_reachable', (SELECT count(*) FROM public.agents a
      WHERE a.status = 'active' AND a.is_owner = false
        AND a.active_for_dialer = true AND a.logged_in = true
        AND a.available_for_transfer = true AND a.transfer_certified = true
        AND a.bland_number IS NOT NULL AND a.bland_number <> ''
        AND a.talkroute_number IS NOT NULL AND a.talkroute_number <> ''
        AND EXISTS (SELECT 1 FROM public.auth_sessions s WHERE s.agent_id = a.id AND s.invalidated_at IS NULL AND s.expires_at > now())
    ),
    'daily_minute_cap', (SELECT daily_minute_cap FROM public.campaigns ORDER BY created_at DESC LIMIT 1),
    'daily_minutes_used', round(COALESCE((SELECT sum(duration_seconds) FROM public.calls WHERE call_direction = 'outbound' AND bridge_confirmed = true AND created_at >= date_trunc('day', now())), 0)::numeric / 60.0, 1),
    'transfers_requested_today', (SELECT count(*) FROM public.calls WHERE transfer_requested_at IS NOT NULL AND created_at >= date_trunc('day', now())),
    'talkroute_dialed_today', (SELECT count(*) FROM public.calls WHERE talkroute_leg_created = true AND created_at >= date_trunc('day', now())),
    'agent_answered_today', (SELECT count(*) FROM public.calls WHERE talkroute_answered = true AND created_at >= date_trunc('day', now())),
    'bridge_confirmed_today', (SELECT count(*) FROM public.calls WHERE bridge_confirmed = true AND created_at >= date_trunc('day', now())),
    'transfer_failed_unverified_today', (SELECT count(*) FROM public.calls WHERE transfer_requested_at IS NOT NULL AND bridge_confirmed = false AND created_at >= date_trunc('day', now())),
    'transfers_requested_week', (SELECT count(*) FROM public.calls WHERE transfer_requested_at IS NOT NULL AND created_at >= date_trunc('week', now())),
    'talkroute_dialed_week', (SELECT count(*) FROM public.calls WHERE talkroute_leg_created = true AND created_at >= date_trunc('week', now())),
    'agent_answered_week', (SELECT count(*) FROM public.calls WHERE talkroute_answered = true AND created_at >= date_trunc('week', now())),
    'bridge_confirmed_week', (SELECT count(*) FROM public.calls WHERE bridge_confirmed = true AND created_at >= date_trunc('week', now())),
    'transfer_failed_unverified_week', (SELECT count(*) FROM public.calls WHERE transfer_requested_at IS NOT NULL AND bridge_confirmed = false AND created_at >= date_trunc('week', now()))
  ) INTO v_summary;

  FOR v_agent IN SELECT * FROM public.agents WHERE status = 'active' ORDER BY created_at
  LOOP
    v_durations := public.get_agent_session_durations(v_agent.id);

    SELECT jsonb_build_object(
      'id', v_agent.id,
      'full_name', v_agent.full_name,
      'role', v_agent.role,
      'status', v_agent.status,
      'bland_number', v_agent.bland_number,
      'talkroute_number', v_agent.talkroute_number,
      'agent_direct_number', v_agent.agent_direct_number,
      'active_for_dialer', v_agent.active_for_dialer,
      'dialer_concurrency', COALESCE(v_agent.dialer_concurrency, 2),
      'transfer_certified', v_agent.transfer_certified,
      'currently_receiving', COALESCE(v_agent.available_for_transfer, false),
      'logged_in', COALESCE(v_agent.logged_in, false),
      'available_for_transfer', COALESCE(v_agent.available_for_transfer, false),
      'outbound_attempts_today', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND call_direction = 'outbound' AND created_at >= date_trunc('day', now())),
      'live_humans', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND is_live_human = true AND created_at >= date_trunc('day', now())),
      'human_drops', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'human_drop' AND created_at >= date_trunc('day', now())),
      'fire_transfers', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'fire_transfer' AND created_at >= date_trunc('day', now())),
      'no_answers', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'no_answer' AND created_at >= date_trunc('day', now())),
      'voice_messages', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'voice_message' AND created_at >= date_trunc('day', now())),
      'pending_calls', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'pending'),
      'outbound_attempts_week', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND call_direction = 'outbound' AND created_at >= date_trunc('week', now())),
      'live_humans_week', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND is_live_human = true AND created_at >= date_trunc('week', now())),
      'human_drops_week', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'human_drop' AND created_at >= date_trunc('week', now())),
      'fire_transfers_week', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'fire_transfer' AND created_at >= date_trunc('week', now())),
      'no_answers_week', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'no_answer' AND created_at >= date_trunc('week', now())),
      'voice_messages_week', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'voice_message' AND created_at >= date_trunc('week', now())),
      'fire_transfers_all', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'fire_transfer'),
      'human_drops_all', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'human_drop'),
      'live_humans_all', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND is_live_human = true),
      'callbacks_due', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND callback_requested = true AND is_completed = false),
      'completed_callbacks', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND is_completed = true AND callback_requested = true),
      'voicemails_detected', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'voice_message' AND created_at >= date_trunc('day', now())),
      'busy_calls', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND disposition = 'busy' AND created_at >= date_trunc('day', now())),
      'invalid_numbers', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND disposition = 'invalid_number' AND created_at >= date_trunc('day', now())),
      'dnc_requests', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND is_dnc = true AND created_at >= date_trunc('day', now())),
      'avg_ai_duration', (SELECT COALESCE(avg(duration_seconds), 0) FROM public.calls WHERE agent_id = v_agent.id AND is_live_human = true AND created_at >= date_trunc('day', now())),
      'bridge_confirmed_today', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND bridge_confirmed = true AND created_at >= date_trunc('day', now())),
      'talkroute_answered_today', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND talkroute_answered = true AND created_at >= date_trunc('day', now())),
      'bridge_confirmed_week', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND bridge_confirmed = true AND created_at >= date_trunc('week', now())),
      'talkroute_answered_week', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND talkroute_answered = true AND created_at >= date_trunc('week', now())),
      'transfers_requested_today', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND transfer_requested_at IS NOT NULL AND created_at >= date_trunc('day', now())),
      'talkroute_dialed_today', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND talkroute_leg_created = true AND created_at >= date_trunc('day', now())),
      'transfer_failed_unverified_today', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND transfer_requested_at IS NOT NULL AND bridge_confirmed = false AND created_at >= date_trunc('day', now())),
      'likely_real_conversation_today', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND bridge_confirmed = true AND duration_seconds >= 45 AND created_at >= date_trunc('day', now())),
      'productive_minutes_today', round(COALESCE((SELECT sum(duration_seconds) FROM public.calls WHERE agent_id = v_agent.id AND bridge_confirmed = true AND created_at >= date_trunc('day', now())), 0)::numeric / 60.0, 1),
      'wasted_minutes_today', round(COALESCE((SELECT sum(duration_seconds) FROM public.calls WHERE agent_id = v_agent.id AND (queue IN ('no_answer','voice_message') OR is_live_human = false) AND created_at >= date_trunc('day', now())), 0)::numeric / 60.0, 1),
      'total_minutes_today', round(COALESCE((SELECT sum(duration_seconds) FROM public.calls WHERE agent_id = v_agent.id AND call_direction = 'outbound' AND created_at >= date_trunc('day', now())), 0)::numeric / 60.0, 1),
      'talkroute_answer_rate', CASE
        WHEN (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND talkroute_leg_created = true AND created_at >= date_trunc('day', now())) > 0
        THEN (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND talkroute_answered = true AND created_at >= date_trunc('day', now()))::numeric /
        (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND talkroute_leg_created = true AND created_at >= date_trunc('day', now()))
        ELSE 0 END,
      'fire_transfer_rate', CASE
        WHEN (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND is_live_human = true AND created_at >= date_trunc('day', now())) > 0
        THEN (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'fire_transfer' AND created_at >= date_trunc('day', now()))::numeric /
        (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND is_live_human = true AND created_at >= date_trunc('day', now()))
        ELSE 0 END,
      'last_call_time', (SELECT max(created_at) FROM public.calls WHERE agent_id = v_agent.id)
    ) INTO v_stats;

    v_stats := v_stats || COALESCE(v_durations, '{}'::jsonb);
    v_agents_list := array_append(v_agents_list, v_stats);
  END LOOP;

  v_agents := COALESCE(jsonb_agg(v), '[]'::jsonb) FROM unnest(v_agents_list) v;
  RETURN jsonb_build_object('summary', v_summary, 'agents', v_agents);
END;
$$;
