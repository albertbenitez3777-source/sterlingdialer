/*
# Fix get_admin_stats — use get_agent_session_durations() instead of non-existent session_durations table

The previous migration (update_admin_stats_with_concurrency) incorrectly referenced a
session_durations table that does not exist. This restores the original session duration
logic (get_agent_session_durations function) while keeping the new dialer_concurrency field.
*/

CREATE OR REPLACE FUNCTION public.get_admin_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
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
  SELECT count(*) INTO v_agents_dialing FROM public.agents WHERE active_for_dialer = true AND logged_in = true AND status = 'active' AND is_owner = false;

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
