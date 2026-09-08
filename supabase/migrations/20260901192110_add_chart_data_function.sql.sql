-- Chart data functions: hourly call counts + hourly connect rates for last 7 days
CREATE OR REPLACE FUNCTION public.get_chart_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    -- Calls per hour today
    'calls_per_hour_today', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.hour)
      FROM (
        SELECT
          EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/New_York')::int AS hour,
          count(*) AS calls,
          count(*) FILTER (WHERE queue = 'fire_transfer') AS transfers,
          count(*) FILTER (WHERE queue = 'no_answer') AS no_answer,
          count(*) FILTER (WHERE queue = 'voice_message') AS voicemail,
          count(*) FILTER (WHERE queue = 'human_drop') AS drops,
          count(*) FILTER (WHERE is_live_human = true) AS live_humans
        FROM public.calls
        WHERE call_direction = 'outbound'
          AND created_at >= date_trunc('day', now() AT TIME ZONE 'America/New_York' AT TIME ZONE 'America/New_York')
          AND created_at < date_trunc('day', (now() + interval '1 day') AT TIME ZONE 'America/New_York' AT TIME ZONE 'America/New_York')
        GROUP BY 1
      ) r
    ), '[]'::jsonb),
    -- Calls per day this week
    'calls_per_day_week', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.day)
      FROM (
        SELECT
          to_char(date_trunc('day', created_at AT TIME ZONE 'America/New_York'), 'Mon DD') AS day,
          count(*) AS calls,
          count(*) FILTER (WHERE queue = 'fire_transfer') AS transfers,
          count(*) FILTER (WHERE queue = 'no_answer') AS no_answer,
          count(*) FILTER (WHERE queue = 'voice_message') AS voicemail,
          count(*) FILTER (WHERE queue = 'human_drop') AS drops,
          count(*) FILTER (WHERE is_live_human = true) AS live_humans
        FROM public.calls
        WHERE call_direction = 'outbound'
          AND created_at >= date_trunc('week', now() AT TIME ZONE 'America/New_York' AT TIME ZONE 'America/New_York')
        GROUP BY 1
      ) r
    ), '[]'::jsonb),
    -- Outcome breakdown today
    'outcome_breakdown_today', jsonb_build_object(
      'fire_transfer', (SELECT count(*) FROM public.calls WHERE call_direction = 'outbound' AND queue = 'fire_transfer' AND created_at >= date_trunc('day', now())),
      'no_answer', (SELECT count(*) FROM public.calls WHERE call_direction = 'outbound' AND queue = 'no_answer' AND created_at >= date_trunc('day', now())),
      'voice_message', (SELECT count(*) FROM public.calls WHERE call_direction = 'outbound' AND queue = 'voice_message' AND created_at >= date_trunc('day', now())),
      'human_drop', (SELECT count(*) FROM public.calls WHERE call_direction = 'outbound' AND queue = 'human_drop' AND created_at >= date_trunc('day', now()))
    ),
    -- Per-agent performance today
    'per_agent_today', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.transfers DESC)
      FROM (
        SELECT
          a.full_name AS name,
          a.id AS agent_id,
          count(*) FILTER (WHERE c.call_direction = 'outbound') AS calls,
          count(*) FILTER (WHERE c.queue = 'fire_transfer') AS transfers,
          count(*) FILTER (WHERE c.bridge_confirmed = true) AS handed_off,
          CASE
            WHEN count(*) FILTER (WHERE c.call_direction = 'outbound' AND c.provider_call_id IS NOT NULL AND c.provider_call_id <> '') > 0
            THEN round(
              count(*) FILTER (WHERE c.is_live_human = true)::numeric /
              count(*) FILTER (WHERE c.call_direction = 'outbound' AND c.provider_call_id IS NOT NULL AND c.provider_call_id <> '') * 100, 1
            )
            ELSE 0
          END AS connect_rate
        FROM public.agents a
        LEFT JOIN public.calls c ON c.agent_id = a.id AND c.created_at >= date_trunc('day', now())
        WHERE a.status = 'active' AND a.is_owner = false
        GROUP BY a.id, a.full_name
      ) r
    ), '[]'::jsonb),
    -- Best time to call: connect rate by hour-of-day over last 7 days
    'best_time_by_hour', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.hour)
      FROM (
        SELECT
          EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/New_York')::int AS hour,
          count(*) AS calls,
          count(*) FILTER (WHERE queue = 'fire_transfer') AS transfers,
          CASE
            WHEN count(*) > 0
            THEN round(count(*) FILTER (WHERE queue = 'fire_transfer')::numeric / count(*) * 100, 1)
            ELSE 0
          END AS connect_rate
        FROM public.calls
        WHERE call_direction = 'outbound'
          AND created_at >= now() - interval '7 days'
        GROUP BY 1
      ) r
    ), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_chart_data() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_chart_data() TO authenticated, anon;
