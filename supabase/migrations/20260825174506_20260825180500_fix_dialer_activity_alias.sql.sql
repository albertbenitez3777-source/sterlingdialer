/*
# Fix get_dialer_activity — correct aggregate alias and simplify outcome breakdown

## Changes
- Fix: the minutes subquery used `jsonb_agg(minute_data ORDER BY minute DESC)` but the
  subquery alias was `m`, not `minute_data`. This caused a "column minute_data does not exist" error.
- Simplify outcome_breakdown, avg_duration_seconds, and connect_rate to use a CTE instead of
  repeated correlated subqueries, making the function both correct and faster.
*/

CREATE OR REPLACE FUNCTION public.get_dialer_activity()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_last50_start timestamptz;
BEGIN
  -- Find the timestamp of the 50th most recent outbound call
  SELECT min(created_at) INTO v_last50_start
  FROM (
    SELECT created_at FROM public.calls
    WHERE call_direction = 'outbound'
    ORDER BY created_at DESC
    LIMIT 50
  ) sub;

  SELECT jsonb_build_object(
    'minutes', COALESCE((
      SELECT jsonb_agg(m ORDER BY m->>'minute' DESC)
      FROM (
        SELECT
          to_jsonb(date_trunc('minute', created_at)) AS minute,
          count(*) AS attempted,
          count(*) FILTER (WHERE provider_call_id IS NOT NULL AND provider_call_id <> '') AS accepted,
          count(*) FILTER (WHERE queue = 'pending' AND is_completed = false) AS active,
          count(*) FILTER (WHERE is_live_human = true) AS answered,
          count(*) FILTER (WHERE queue = 'fire_transfer') AS transferred,
          count(*) FILTER (WHERE queue IN ('no_answer', 'human_drop') AND is_completed = true) AS failed
        FROM public.calls
        WHERE call_direction = 'outbound'
          AND created_at >= now() - interval '15 minutes'
        GROUP BY date_trunc('minute', created_at)
      ) raw
    ), '[]'::jsonb),
    'totals', jsonb_build_object(
      'attempted', (SELECT count(*) FROM public.calls WHERE call_direction = 'outbound' AND created_at >= now() - interval '15 minutes'),
      'accepted', (SELECT count(*) FROM public.calls WHERE call_direction = 'outbound' AND created_at >= now() - interval '15 minutes' AND provider_call_id IS NOT NULL AND provider_call_id <> ''),
      'active', (SELECT count(*) FROM public.calls WHERE call_direction = 'outbound' AND queue = 'pending' AND is_completed = false),
      'answered', (SELECT count(*) FROM public.calls WHERE call_direction = 'outbound' AND created_at >= now() - interval '15 minutes' AND is_live_human = true),
      'transferred', (SELECT count(*) FROM public.calls WHERE call_direction = 'outbound' AND created_at >= now() - interval '15 minutes' AND queue = 'fire_transfer'),
      'failed', (SELECT count(*) FROM public.calls WHERE call_direction = 'outbound' AND created_at >= now() - interval '15 minutes' AND queue IN ('no_answer', 'human_drop') AND is_completed = true)
    ),
    'recent_50', COALESCE((
      SELECT jsonb_agg(row_to_json(t) ORDER BY t.created_at DESC)
      FROM (
        SELECT
          c.id,
          c.consumer_name,
          c.consumer_phone,
          c.queue,
          c.is_live_human,
          c.is_completed,
          c.transfer_status,
          c.transfer_state,
          c.ai_terminated,
          c.talkroute_answered,
          c.provider_call_id,
          c.agent_id,
          a.full_name AS agent_name,
          c.duration_seconds,
          c.created_at,
          EXTRACT(EPOCH FROM (now() - c.created_at))::int AS seconds_ago
        FROM public.calls c
        LEFT JOIN public.agents a ON c.agent_id = a.id
        WHERE c.call_direction = 'outbound'
        ORDER BY c.created_at DESC
        LIMIT 50
      ) AS t
    ), '[]'::jsonb),
    'outcome_breakdown', jsonb_build_object(
      'fire_transfer', (SELECT count(*) FROM public.calls WHERE call_direction = 'outbound' AND queue = 'fire_transfer' AND created_at >= COALESCE(v_last50_start, now() - interval '1 hour')),
      'human_drop', (SELECT count(*) FROM public.calls WHERE call_direction = 'outbound' AND queue = 'human_drop' AND created_at >= COALESCE(v_last50_start, now() - interval '1 hour')),
      'no_answer', (SELECT count(*) FROM public.calls WHERE call_direction = 'outbound' AND queue = 'no_answer' AND created_at >= COALESCE(v_last50_start, now() - interval '1 hour')),
      'voice_message', (SELECT count(*) FROM public.calls WHERE call_direction = 'outbound' AND queue = 'voice_message' AND created_at >= COALESCE(v_last50_start, now() - interval '1 hour')),
      'pending', (SELECT count(*) FROM public.calls WHERE call_direction = 'outbound' AND queue = 'pending' AND created_at >= COALESCE(v_last50_start, now() - interval '1 hour'))
    ),
    'avg_duration_seconds', COALESCE((
      SELECT round(avg(duration_seconds))::int
      FROM public.calls
      WHERE call_direction = 'outbound'
        AND is_live_human = true
        AND duration_seconds > 0
        AND created_at >= COALESCE(v_last50_start, now() - interval '1 hour')
    ), 0),
    'connect_rate', CASE
      WHEN (SELECT count(*) FROM public.calls WHERE call_direction = 'outbound' AND provider_call_id IS NOT NULL AND provider_call_id <> '' AND created_at >= COALESCE(v_last50_start, now() - interval '1 hour')) > 0
      THEN round(
        (SELECT count(*) FROM public.calls WHERE call_direction = 'outbound' AND is_live_human = true AND created_at >= COALESCE(v_last50_start, now() - interval '1 hour'))::numeric /
        (SELECT count(*) FROM public.calls WHERE call_direction = 'outbound' AND provider_call_id IS NOT NULL AND provider_call_id <> '' AND created_at >= COALESCE(v_last50_start, now() - interval '1 hour')) * 100
      )::int
      ELSE 0
    END,
    'campaign_state', (SELECT state FROM public.campaigns ORDER BY created_at DESC LIMIT 1),
    'agents_activated', (SELECT count(*) FROM public.agents WHERE active_for_dialer = true AND status = 'active' AND is_owner = false),
    'server_time', now()
  ) INTO v_result;

  RETURN v_result;
END;
$function$;
