/*
# v254 — Fix agent stats live_humans + fix RPC/admin_stats timezone

1. Adds `live_humans` field (is_live_human=true count) to get_agent_stats
2. Fixes get_agent_opportunities timezone: uses correct AT TIME ZONE pattern
3. Fixes get_admin_stats timezone: uses correct AT TIME ZONE pattern

The broken pattern was: `date::timestamptz AT TIME ZONE 'America/New_York'`
which strips timezone info and produces a bare timestamp interpreted as UTC.
The correct pattern is: `(date || ' 00:00:00')::timestamp AT TIME ZONE 'America/New_York'`
which says "this timestamp IS in Eastern, give me UTC equivalent".
*/

-- 1. Fix get_agent_stats: add live_humans field
CREATE OR REPLACE FUNCTION public.get_agent_stats(p_agent_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
v_result jsonb;
v_durations jsonb;
v_today_start timestamptz;
BEGIN
v_today_start := date_trunc('day', now() AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York';

SELECT jsonb_build_object(
'live_humans',       (SELECT count(*) FROM public.calls WHERE agent_id = p_agent_id AND is_live_human = true AND created_at >= v_today_start),
'human_drops',       (SELECT count(*) FROM public.calls WHERE agent_id = p_agent_id AND queue = 'human_drop' AND created_at >= v_today_start),
'fire_transfers',    (SELECT count(*) FROM public.calls WHERE agent_id = p_agent_id AND queue = 'fire_transfer' AND created_at >= v_today_start),
'voice_messages',    (SELECT count(*) FROM public.calls WHERE agent_id = p_agent_id AND queue = 'voice_message' AND created_at >= v_today_start),
'failed_transfers',  (SELECT count(*) FROM public.calls WHERE agent_id = p_agent_id AND queue = 'human_drop' AND transfer_failure_reason <> '' AND created_at >= v_today_start),
'callbacks_due',     (SELECT count(*) FROM public.calls WHERE agent_id = p_agent_id AND callback_requested = true AND is_completed = false AND created_at >= v_today_start),
'completed_callbacks',(SELECT count(*) FROM public.calls WHERE agent_id = p_agent_id AND is_completed = true AND callback_requested = true AND created_at >= v_today_start),
'new_voicemails',    (SELECT count(*) FROM public.calls WHERE agent_id = p_agent_id AND queue = 'voice_message' AND voicemail_status = 'new'),
'active_calls_now',  (SELECT count(*) FROM public.calls WHERE agent_id = p_agent_id AND created_at >= (now() - interval '10 minutes') AND duration_seconds = 0 AND (agent_disposition IS NULL OR agent_disposition = '') AND is_completed = false),
'today_total',       (SELECT count(*) FROM public.calls WHERE agent_id = p_agent_id AND created_at >= v_today_start)
) INTO v_result;

SELECT public.get_agent_session_durations(p_agent_id) INTO v_durations;
v_result := v_result || v_durations;

RETURN v_result;
END;
$$;

-- 2. Fix get_agent_opportunities timezone
CREATE OR REPLACE FUNCTION public.get_agent_opportunities(
  p_agent_id uuid,
  p_tab text DEFAULT 'today'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today_start timestamptz;
  v_week_start timestamptz;
  v_et_date date;
  v_dow int;
  v_rows jsonb;
  v_today_count int;
  v_week_count int;
  v_all_count int;
BEGIN
  v_et_date := (now() AT TIME ZONE 'America/New_York')::date;
  v_today_start := (v_et_date || ' 00:00:00')::timestamp AT TIME ZONE 'America/New_York';
  v_dow := extract(dow from v_et_date)::int;
  v_week_start := ((v_et_date - ((CASE WHEN v_dow = 0 THEN 6 ELSE v_dow - 1 END) || ' days')::interval)::date || ' 00:00:00')::timestamp AT TIME ZONE 'America/New_York';

  WITH opp_rows AS (
    SELECT
      c.id, c.lead_id, c.consumer_name, c.consumer_phone, c.consumer_address,
      c.consumer_home_value, c.consumer_income_range, c.consumer_property_info,
      c.consumer_custom_fields, c.queue, c.created_at, c.duration_seconds,
      c.ai_summary, left(c.transcript, 200) as transcript_preview,
      c.recording_url, c.transfer_status, c.transfer_requested_at,
      c.talkroute_leg_created, c.talkroute_answered, c.is_live_human,
      c.agent_disposition, c.callback_requested, c.bridge_confirmed_at,
      c.bridge_confirmed, c.agent_notes, c.is_completed, c.provider_call_id,
      c.has_post_transfer_ai_speech, c.human_agreed_transfer,
      c.voicemail_status, c.transfer_failure_reason, c.agent_id
    FROM calls c
    WHERE c.agent_id = p_agent_id
      AND (
        c.is_live_human = true
        OR c.transfer_requested_at IS NOT NULL
        OR c.talkroute_leg_created = true
        OR c.queue IN ('human_drop', 'voice_message', 'fire_transfer')
        OR c.callback_requested = true
        OR c.human_agreed_transfer = true
      )
      AND (
        CASE
          WHEN p_tab = 'today' THEN c.created_at >= v_today_start
          WHEN p_tab = 'week' THEN c.created_at >= v_week_start
          ELSE true
        END
      )
    ORDER BY c.created_at DESC
    LIMIT 500
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(opp_rows)), '[]'::jsonb)
  INTO v_rows
  FROM opp_rows;

  SELECT count(*) INTO v_today_count
  FROM calls WHERE agent_id = p_agent_id AND created_at >= v_today_start
    AND (is_live_human = true OR transfer_requested_at IS NOT NULL OR talkroute_leg_created = true
         OR queue IN ('human_drop','voice_message','fire_transfer') OR callback_requested = true OR human_agreed_transfer = true);

  SELECT count(*) INTO v_week_count
  FROM calls WHERE agent_id = p_agent_id AND created_at >= v_week_start
    AND (is_live_human = true OR transfer_requested_at IS NOT NULL OR talkroute_leg_created = true
         OR queue IN ('human_drop','voice_message','fire_transfer') OR callback_requested = true OR human_agreed_transfer = true);

  SELECT count(*) INTO v_all_count
  FROM calls WHERE agent_id = p_agent_id
    AND (is_live_human = true OR transfer_requested_at IS NOT NULL OR talkroute_leg_created = true
         OR queue IN ('human_drop','voice_message','fire_transfer') OR callback_requested = true OR human_agreed_transfer = true);

  RETURN jsonb_build_object(
    'rows', v_rows,
    'counts', jsonb_build_object('today', v_today_count, 'week', v_week_count, 'all', v_all_count),
    'server_today_start', v_today_start,
    'server_week_start', v_week_start
  );
END;
$$;

-- 3. Fix get_admin_stats timezone (same pattern)
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
v_et_today_start := date_trunc('day', now() AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York';

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

FOR v_agent IN
SELECT * FROM public.agents WHERE role <> 'owner' ORDER BY
CASE WHEN status = 'active' THEN 0 ELSE 1 END, full_name
LOOP
SELECT public.get_agent_session_durations(v_agent.id) INTO v_durations;
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

GRANT EXECUTE ON FUNCTION public.get_agent_stats(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_agent_opportunities(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_stats() TO authenticated, service_role;
