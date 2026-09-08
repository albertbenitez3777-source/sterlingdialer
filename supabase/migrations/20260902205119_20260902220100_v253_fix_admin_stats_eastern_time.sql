/*
# v253 — Fix admin_stats to use Eastern time boundaries

Replaces all `date_trunc('day', now())` (UTC midnight) with Eastern time midnight
for "today" boundaries. This ensures dashboard counts match the agent's actual
Eastern-time day, not UTC.

Changes:
- Added v_et_today_start variable computed as midnight Eastern converted to UTC
- Replaced all 26 instances of date_trunc('day', now()) with v_et_today_start
- Also fixes get_funnel_stats today boundary to use Eastern time
*/

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
v_stats2 jsonb;
v_durations jsonb;
v_funnel_today jsonb;
v_funnel_week jsonb;
v_funnel_all jsonb;
v_errors jsonb;
v_et_today_start timestamptz;
BEGIN
-- Compute Eastern time "today" start as UTC timestamp
v_et_today_start := ((now() AT TIME ZONE 'America/New_York')::date)::timestamptz AT TIME ZONE 'America/New_York';

SELECT public.get_funnel_stats(v_et_today_start, now() + interval '1 second') INTO v_funnel_today;
SELECT public.get_funnel_stats(now() - interval '7 days', now() + interval '1 second') INTO v_funnel_week;
SELECT public.get_funnel_stats('1900-01-01'::timestamptz, now() + interval '1 second') INTO v_funnel_all;
SELECT public.get_recent_errors(20) INTO v_errors;

SELECT jsonb_build_object(
'campaign_state', COALESCE((SELECT state FROM public.campaigns ORDER BY created_at DESC LIMIT 1), 'idle'),
'dialer_activated', COALESCE((SELECT dialer_activated FROM public.campaigns ORDER BY created_at DESC LIMIT 1), false),
'concurrency', COALESCE((SELECT concurrency FROM public.campaigns ORDER BY created_at DESC LIMIT 1), 1),
'provider_call_limit', COALESCE((SELECT provider_call_limit FROM public.campaigns ORDER BY created_at DESC LIMIT 1), 100),
'leads_remaining', (SELECT count(*) FROM public.leads WHERE status = 'new'),
'calls_attempted_today', (SELECT count(*) FROM public.calls WHERE call_direction = 'outbound' AND created_at >= v_et_today_start),
'live_humans_today', (SELECT count(*) FROM public.calls WHERE is_live_human = true AND created_at >= v_et_today_start),
'human_drops_today', (SELECT count(*) FROM public.calls WHERE queue = 'human_drop' AND created_at >= v_et_today_start),
'fire_transfers_today', (SELECT count(*) FROM public.calls WHERE queue = 'fire_transfer' AND created_at >= v_et_today_start),
'bridge_confirmed_today', (SELECT count(*) FROM public.calls WHERE bridge_confirmed = true AND created_at >= v_et_today_start),
'calls_attempted_week', (SELECT count(*) FROM public.calls WHERE call_direction = 'outbound' AND created_at >= now() - interval '7 days'),
'live_humans_week', (SELECT count(*) FROM public.calls WHERE is_live_human = true AND created_at >= now() - interval '7 days'),
'human_drops_week', (SELECT count(*) FROM public.calls WHERE queue = 'human_drop' AND created_at >= now() - interval '7 days'),
'fire_transfers_week', (SELECT count(*) FROM public.calls WHERE queue = 'fire_transfer' AND created_at >= now() - interval '7 days'),
'bridge_confirmed_week', (SELECT count(*) FROM public.calls WHERE bridge_confirmed = true AND created_at >= now() - interval '7 days'),
'transfers_requested_today', (SELECT count(*) FROM public.calls WHERE transfer_requested_at IS NOT NULL AND created_at >= v_et_today_start),
'talkroute_dialed_today', (SELECT count(*) FROM public.calls WHERE talkroute_leg_created = true AND created_at >= v_et_today_start),
'agent_answered_today', (SELECT count(*) FROM public.calls WHERE talkroute_answered = true AND created_at >= v_et_today_start),
'transfer_failed_unverified_today', (SELECT count(*) FROM public.calls WHERE transfer_status IN ('failed','transfer_failed_unverified') AND created_at >= v_et_today_start),
'transfers_requested_week', (SELECT count(*) FROM public.calls WHERE transfer_requested_at IS NOT NULL AND created_at >= now() - interval '7 days'),
'talkroute_dialed_week', (SELECT count(*) FROM public.calls WHERE talkroute_leg_created = true AND created_at >= now() - interval '7 days'),
'agent_answered_week', (SELECT count(*) FROM public.calls WHERE talkroute_answered = true AND created_at >= now() - interval '7 days'),
'transfer_failed_unverified_week', (SELECT count(*) FROM public.calls WHERE transfer_status IN ('failed','transfer_failed_unverified') AND created_at >= now() - interval '7 days'),
'no_answers_today', (SELECT count(*) FROM public.calls WHERE queue = 'no_answer' AND created_at >= v_et_today_start),
'voice_messages_today', (SELECT count(*) FROM public.calls WHERE queue = 'voice_message' AND created_at >= v_et_today_start),
'blocking_reason', (SELECT COALESCE(blocking_reason,'') FROM public.campaigns ORDER BY created_at DESC LIMIT 1),
'campaign_started_at', (SELECT started_at FROM public.campaigns ORDER BY created_at DESC LIMIT 1),
'dialer_status', COALESCE((SELECT dialer_status FROM public.campaigns ORDER BY created_at DESC LIMIT 1), 'idle'),
'agents_reachable', (SELECT count(*) FROM public.agents WHERE status = 'active' AND available_for_transfer = true AND role <> 'owner'),
'daily_minute_cap', (SELECT daily_minute_cap FROM public.campaigns ORDER BY created_at DESC LIMIT 1),
'daily_minutes_used', COALESCE((SELECT sum(duration_seconds)::numeric / 60 FROM public.calls WHERE call_direction = 'outbound' AND created_at >= v_et_today_start), 0),
'funnel_today', v_funnel_today,
'funnel_week', v_funnel_week,
'funnel_all', v_funnel_all,
'errors_recent', v_errors
) INTO v_summary;

-- Include ALL agents (active + archived) for full roster visibility
FOR v_agent IN
SELECT * FROM public.agents WHERE role <> 'owner' ORDER BY
CASE WHEN status = 'active' THEN 0 ELSE 1 END, full_name
LOOP
SELECT public.get_agent_session_durations(v_agent.id) INTO v_durations;
-- Part 1: today + week metrics
SELECT jsonb_build_object(
'id', v_agent.id,
'full_name', v_agent.full_name,
'role', v_agent.role,
'status', v_agent.status,
'logged_in', v_agent.logged_in,
'is_logged_in', v_agent.logged_in,
'available', v_agent.available_for_transfer,
'available_for_transfer', v_agent.available_for_transfer,
'active_for_dialer', v_agent.active_for_dialer,
'bland_number', v_agent.bland_number,
'talkroute_number', v_agent.talkroute_number,
'agent_direct_number', v_agent.agent_direct_number,
'transfer_certified', v_agent.transfer_certified,
'dialer_concurrency', COALESCE(v_agent.dialer_concurrency, 2),
'currently_receiving', COALESCE(v_agent.available_for_transfer, false),
'outbound_attempts_today', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND call_direction = 'outbound' AND created_at >= v_et_today_start),
'live_humans', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND is_live_human = true AND created_at >= v_et_today_start),
'human_drops', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'human_drop' AND created_at >= v_et_today_start),
'fire_transfers', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'fire_transfer' AND created_at >= v_et_today_start),
'no_answers', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'no_answer' AND created_at >= v_et_today_start),
'voice_messages', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'voice_message' AND created_at >= v_et_today_start),
'inbound_configured', COALESCE(v_agent.inbound_configured, false),
'session_durations', v_durations,
'outbound_attempts_week', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND call_direction = 'outbound' AND created_at >= now() - interval '7 days'),
'live_humans_week', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND is_live_human = true AND created_at >= now() - interval '7 days'),
'human_drops_week', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'human_drop' AND created_at >= now() - interval '7 days'),
'fire_transfers_week', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'fire_transfer' AND created_at >= now() - interval '7 days'),
'talkroute_leg_created_today', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND talkroute_leg_created = true AND created_at >= v_et_today_start),
'talkroute_answered_today', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND talkroute_answered = true AND created_at >= v_et_today_start),
'bridge_confirmed_today', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND bridge_confirmed = true AND created_at >= v_et_today_start),
'talkroute_leg_created_week', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND talkroute_leg_created = true AND created_at >= now() - interval '7 days'),
'talkroute_answered_week', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND talkroute_answered = true AND created_at >= now() - interval '7 days'),
'bridge_confirmed_week', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND bridge_confirmed = true AND created_at >= now() - interval '7 days')
) INTO v_stats;

-- Part 2: all-time metrics
SELECT jsonb_build_object(
'callbacks_today', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND callback_requested = true AND created_at >= v_et_today_start),
'outbound_attempts_all', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND call_direction = 'outbound'),
'live_humans_all', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND is_live_human = true),
'human_drops_all', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'human_drop'),
'fire_transfers_all', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'fire_transfer'),
'talkroute_leg_created_all', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND talkroute_leg_created = true),
'talkroute_answered_all', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND talkroute_answered = true),
'bridge_confirmed_all', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND bridge_confirmed = true),
'transfer_failed_all', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND transfer_status IN ('failed','transfer_failed_unverified')),
'productive_minutes_today', COALESCE((SELECT sum(duration_seconds)::numeric / 60 FROM public.calls WHERE agent_id = v_agent.id AND duration_seconds >= 30 AND created_at >= v_et_today_start), 0),
'wasted_minutes_today', COALESCE((SELECT sum(duration_seconds)::numeric / 60 FROM public.calls WHERE agent_id = v_agent.id AND duration_seconds < 30 AND created_at >= v_et_today_start), 0),
'total_minutes_today', COALESCE((SELECT sum(duration_seconds)::numeric / 60 FROM public.calls WHERE agent_id = v_agent.id AND created_at >= v_et_today_start), 0)
) INTO v_stats2;

v_agents_list := v_agents_list || (v_stats || v_stats2);

END LOOP;

v_agents := to_jsonb(v_agents_list);
RETURN jsonb_build_object('summary', v_summary, 'agents', v_agents);

END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_stats() TO authenticated, service_role;
