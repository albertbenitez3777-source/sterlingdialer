/*
# Fix session duration function
The current-session detection in get_agent_session_durations was not finding active sessions.
Switched from a record variable to explicit column variables with a FOUND check.
*/
CREATE OR REPLACE FUNCTION public.get_agent_session_durations(p_agent_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_session_id uuid;
  v_session_created timestamptz;
  v_current_duration interval;
  v_today_total interval;
  v_week_total interval;
  v_week_start timestamptz;
BEGIN
  -- Find the most recent active session
  SELECT id, created_at INTO v_session_id, v_session_created
  FROM public.auth_sessions
  WHERE agent_id = p_agent_id
    AND invalidated_at IS NULL
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND AND v_session_id IS NOT NULL THEN
    v_current_duration := now() - v_session_created;
  ELSE
    v_current_duration := '0 seconds'::interval;
  END IF;

  -- Today's total: sum durations of all sessions that overlap today
  SELECT COALESCE(sum(
    LEAST(COALESCE(invalidated_at, now()), date_trunc('day', now()) + interval '1 day')
    - GREATEST(created_at, date_trunc('day', now()))
  ), '0 seconds'::interval)
  INTO v_today_total
  FROM public.auth_sessions
  WHERE agent_id = p_agent_id
    AND created_at < date_trunc('day', now()) + interval '1 day'
    AND COALESCE(invalidated_at, now()) > date_trunc('day', now());

  -- Week total: Monday-based week
  v_week_start := date_trunc('week', now());

  SELECT COALESCE(sum(
    LEAST(COALESCE(invalidated_at, now()), v_week_start + interval '7 days')
    - GREATEST(created_at, v_week_start)
  ), '0 seconds'::interval)
  INTO v_week_total
  FROM public.auth_sessions
  WHERE agent_id = p_agent_id
    AND created_at < v_week_start + interval '7 days'
    AND COALESCE(invalidated_at, now()) > v_week_start;

  RETURN jsonb_build_object(
    'current_duration_seconds', extract(epoch FROM v_current_duration)::integer,
    'today_total_seconds', extract(epoch FROM v_today_total)::integer,
    'week_total_seconds', extract(epoch FROM v_week_total)::integer,
    'session_start', v_session_created,
    'is_logged_in', v_session_id IS NOT NULL
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_agent_session_durations FROM anon;
GRANT EXECUTE ON FUNCTION public.get_agent_session_durations TO authenticated;
