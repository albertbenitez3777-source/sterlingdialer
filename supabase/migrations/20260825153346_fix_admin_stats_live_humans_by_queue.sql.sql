/*
 * Fix: admin stats "live_humans" counts were using is_live_human flag,
 * which was unreliable for calls placed before the webhook fix.
 * Now counts by queue (fire_transfer + human_drop) to match the
 * re-dial panel logic exactly — so the numbers the admin sees always
 * match the number of contacts that will actually be dialed.
 */
CREATE OR REPLACE FUNCTION public.get_admin_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_summary jsonb;
  v_agents jsonb;
  v_agents_list jsonb[] := ARRAY[]::jsonb[];
  v_stats jsonb;
  v_agent record;
  v_week_start timestamptz;
BEGIN
  v_week_start := date_trunc('week', now());

  SELECT jsonb_build_object(
    'campaign_state', COALESCE((SELECT state FROM public.campaigns ORDER BY created_at DESC LIMIT 1), 'stopped'),
    'dialer_activated', COALESCE((SELECT dialer_activated FROM public.campaigns ORDER BY created_at DESC LIMIT 1), false),
    'concurrency', COALESCE((SELECT concurrency FROM public.campaigns ORDER BY created_at DESC LIMIT 1), 3),
    'provider_call_limit', COALESCE((SELECT provider_call_limit FROM public.campaigns ORDER BY created_at DESC LIMIT 1), 0),
    'provider_accepted_completed', COALESCE((SELECT provider_accepted_completed FROM public.campaigns ORDER BY created_at DESC LIMIT 1), 0),
    'leads_remaining', (SELECT count(*) FROM public.leads WHERE status = 'new'),
    'calls_attempted_today', (SELECT count(*) FROM public.calls WHERE call_direction = 'outbound' AND created_at >= date_trunc('day', now())),
    'live_humans_today', (SELECT count(*) FROM public.calls WHERE queue IN ('fire_transfer','human_drop') AND created_at >= date_trunc('day', now())),
    'human_drops_today', (SELECT count(*) FROM public.calls WHERE queue = 'human_drop' AND created_at >= date_trunc('day', now())),
    'fire_transfers_today', (SELECT count(*) FROM public.calls WHERE queue = 'fire_transfer' AND created_at >= date_trunc('day', now())),
    'voice_messages_today', (SELECT count(*) FROM public.calls WHERE queue = 'voice_message' AND created_at >= date_trunc('day', now())),
    'no_answers_today', (SELECT count(*) FROM public.calls WHERE queue = 'no_answer' AND created_at >= date_trunc('day', now())),
    'active_calls', (SELECT count(*) FROM public.calls WHERE queue = 'pending'),
    'campaign_started_at', (SELECT started_at FROM public.campaigns ORDER BY created_at DESC LIMIT 1),
    'last_provider_event', (SELECT max(created_at) FROM public.calls),
    'blocking_reason', COALESCE((SELECT blocking_reason FROM public.campaigns ORDER BY created_at DESC LIMIT 1), ''),
    'agents_logged_in', (SELECT count(*) FROM public.agents WHERE logged_in = true AND is_owner = false),
    'agents_available', (SELECT count(*) FROM public.agents WHERE available_for_transfer = true AND is_owner = false),
    'agents_selected_for_dialer', (SELECT count(*) FROM public.agents WHERE active_for_dialer = true AND is_owner = false),
    'agents_dialing', (SELECT count(DISTINCT agent_id) FROM public.calls WHERE queue = 'pending'),
    'total_login_hours_today', 0,
    'calls_attempted_week', (SELECT count(*) FROM public.calls WHERE call_direction = 'outbound' AND created_at >= v_week_start),
    'live_humans_week', (SELECT count(*) FROM public.calls WHERE queue IN ('fire_transfer','human_drop') AND created_at >= v_week_start),
    'human_drops_week', (SELECT count(*) FROM public.calls WHERE queue = 'human_drop' AND created_at >= v_week_start),
    'fire_transfers_week', (SELECT count(*) FROM public.calls WHERE queue = 'fire_transfer' AND created_at >= v_week_start),
    'voice_messages_week', (SELECT count(*) FROM public.calls WHERE queue = 'voice_message' AND created_at >= v_week_start),
    'no_answers_week', (SELECT count(*) FROM public.calls WHERE queue = 'no_answer' AND created_at >= v_week_start)
  ) INTO v_summary;

  FOR v_agent IN SELECT * FROM public.agents WHERE visible_in_admin = true ORDER BY full_name LOOP
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
      'live_humans', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue IN ('fire_transfer','human_drop') AND created_at >= date_trunc('day', now())),
      'human_drops', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'human_drop' AND created_at >= date_trunc('day', now())),
      'fire_transfers', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'fire_transfer' AND created_at >= date_trunc('day', now())),
      'no_answers', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'no_answer' AND created_at >= date_trunc('day', now())),
      'voice_messages', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'voice_message' AND created_at >= date_trunc('day', now())),
      'pending_calls', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'pending'),
      'currently_receiving', (SELECT count(*) > 0 FROM public.calls WHERE agent_id = v_agent.id AND queue = 'pending'),
      'last_call_time', (SELECT max(created_at) FROM public.calls WHERE agent_id = v_agent.id),
      'outbound_attempts_week', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND call_direction = 'outbound' AND created_at >= v_week_start),
      'live_humans_week', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue IN ('fire_transfer','human_drop') AND created_at >= v_week_start),
      'human_drops_week', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'human_drop' AND created_at >= v_week_start),
      'fire_transfers_week', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'fire_transfer' AND created_at >= v_week_start),
      'no_answers_week', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'no_answer' AND created_at >= v_week_start),
      'voice_messages_week', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'voice_message' AND created_at >= v_week_start)
    ) INTO v_stats;
    v_agents_list := array_append(v_agents_list, v_stats);
  END LOOP;

  v_agents := COALESCE(jsonb_agg(v), '[]'::jsonb) FROM unnest(v_agents_list) v;
  RETURN jsonb_build_object('summary', v_summary, 'agents', v_agents);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_admin_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_stats() TO authenticated, anon;
