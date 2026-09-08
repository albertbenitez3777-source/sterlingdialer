-- Fix get_admin_stats: correct table name (campaigns not campaign) + add daily minute cap fields
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
    'campaign_started_at', (SELECT campaign_started_at FROM public.campaigns ORDER BY created_at DESC LIMIT 1),
    'calls_attempted_week', (SELECT count(*) FROM public.calls WHERE call_direction = 'outbound' AND created_at >= date_trunc('week', now())),
    'live_humans_week', (SELECT count(*) FROM public.calls WHERE is_live_human = true AND created_at >= date_trunc('week', now())),
    'human_drops_week', (SELECT count(*) FROM public.calls WHERE queue = 'human_drop' AND created_at >= date_trunc('week', now())),
    'fire_transfers_week', (SELECT count(*) FROM public.calls WHERE queue = 'fire_transfer' AND created_at >= date_trunc('week', now())),
    'no_answers_week', (SELECT count(*) FROM public.calls WHERE queue = 'no_answer' AND created_at >= date_trunc('week', now())),
    'voice_messages_week', (SELECT count(*) FROM public.calls WHERE queue = 'voice_message' AND created_at >= date_trunc('week', now())),
    'dialer_status', COALESCE((SELECT dialer_status FROM public.campaigns ORDER BY created_at DESC LIMIT 1), 'idle'),
    'agents_reachable', (SELECT count(*) FROM public.agents WHERE status = 'active' AND active_for_dialer = true),
    'daily_minute_cap', (SELECT daily_minute_cap FROM public.campaigns ORDER BY created_at DESC LIMIT 1),
    'daily_minutes_used', round(COALESCE((SELECT sum(duration_seconds) FROM public.calls WHERE call_direction = 'outbound' AND bridge_confirmed = true AND created_at >= date_trunc('day', now())), 0)::numeric / 60.0, 1)
  ) INTO v_summary;

  FOR v_agent IN SELECT * FROM public.agents WHERE status = 'active' ORDER BY created_at
  LOOP
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
      'currently_receiving', COALESCE(v_agent.currently_receiving, false),
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
      'transfers_requested_today', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND (queue = 'fire_transfer' OR transfer_requested_at IS NOT NULL) AND created_at >= date_trunc('day', now())),
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
    v_stats := v_stats || v_durations;
    v_agents_list := array_append(v_agents_list, v_stats);
  END LOOP;
  v_agents := COALESCE(jsonb_agg(v), '[]'::jsonb) FROM unnest(v_agents_list) v;
  RETURN jsonb_build_object('summary', v_summary, 'agents', v_agents);
END;
$$;
