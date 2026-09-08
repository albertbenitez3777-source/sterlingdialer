/*
# Add dialer activity tracking function

## Purpose
Provides a per-minute breakdown of dialer call activity so the owner can
verify the system is actually dialing numbers in real time. Returns calls
grouped by minute for the last 15 minutes, showing how many were attempted,
accepted by Bland, active right now, answered by humans, transferred, and
failed.

## New Function
- `get_dialer_activity()` — returns jsonb with:
  - `minutes`: array of per-minute buckets, each with:
    - `minute`: timestamp truncated to the minute
    - `attempted`: calls created in that minute (outbound only)
    - `accepted`: calls where Bland assigned a provider_call_id
    - `active`: calls still pending (in progress right now)
    - `answered`: calls where a live human was detected
    - `transferred`: calls that reached fire_transfer queue
    - `failed`: calls that ended in no_answer or failed
  - `totals`: aggregate for the last 15 minutes
  - `recent_calls`: the 10 most recent outbound calls with status info
*/

CREATE OR REPLACE FUNCTION public.get_dialer_activity()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'minutes', COALESCE((
      SELECT jsonb_agg(minute_data ORDER BY minute DESC)
      FROM (
        SELECT
          date_trunc('minute', created_at) AS minute,
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
      ) AS m
    ), '[]'::jsonb),
    'totals', jsonb_build_object(
      'attempted', (SELECT count(*) FROM public.calls WHERE call_direction = 'outbound' AND created_at >= now() - interval '15 minutes'),
      'accepted', (SELECT count(*) FROM public.calls WHERE call_direction = 'outbound' AND created_at >= now() - interval '15 minutes' AND provider_call_id IS NOT NULL AND provider_call_id <> ''),
      'active', (SELECT count(*) FROM public.calls WHERE call_direction = 'outbound' AND queue = 'pending' AND is_completed = false),
      'answered', (SELECT count(*) FROM public.calls WHERE call_direction = 'outbound' AND created_at >= now() - interval '15 minutes' AND is_live_human = true),
      'transferred', (SELECT count(*) FROM public.calls WHERE call_direction = 'outbound' AND created_at >= now() - interval '15 minutes' AND queue = 'fire_transfer'),
      'failed', (SELECT count(*) FROM public.calls WHERE call_direction = 'outbound' AND created_at >= now() - interval '15 minutes' AND queue IN ('no_answer', 'human_drop') AND is_completed = true)
    ),
    'recent_calls', COALESCE((
      SELECT jsonb_agg(c ORDER BY c.created_at DESC)
      FROM (
        SELECT
          id,
          consumer_name,
          consumer_phone,
          queue,
          is_live_human,
          is_completed,
          transfer_state,
          transfer_status,
          provider_call_id,
          agent_id,
          duration_seconds,
          created_at,
          EXTRACT(EPOCH FROM (now() - created_at))::int AS seconds_ago
        FROM public.calls
        WHERE call_direction = 'outbound'
        ORDER BY created_at DESC
        LIMIT 10
      ) AS c
    ), '[]'::jsonb),
    'campaign_state', (SELECT state FROM public.campaigns ORDER BY created_at DESC LIMIT 1),
    'agents_activated', (SELECT count(*) FROM public.agents WHERE active_for_dialer = true AND status = 'active' AND is_owner = false),
    'server_time', now()
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_dialer_activity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dialer_activity() TO authenticated, anon;