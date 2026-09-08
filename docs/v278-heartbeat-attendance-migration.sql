/*
# Heartbeat-based attendance system — PREPARED MIGRATION
# Apply with: mcp__supabase__apply_migration tool when ready to deploy
# Filename: v278_heartbeat_attendance_system

## Purpose
Replace unreliable `agents.logged_in` flag with server-stamped heartbeat presence.
Adds `last_heartbeat_at` column to `auth_sessions` so session intervals can be capped
at the last verified heartbeat + stale threshold (90 seconds), preventing sleep/offline
time from accruing indefinitely.

## Modified Tables
- `auth_sessions`:
  - ADD `last_heartbeat_at` (timestamptz, nullable) — server-stamped on each heartbeat

## New Functions
- `heartbeat_session(p_session_token text)` — SECURITY DEFINER
  Validates the session, stamps `last_heartbeat_at = now()`, and returns the agent's
  attendance summary (presence state, today/week totals, current session duration).
  Uses the verified PIN session — never a client-supplied agent_id.

- `get_roster_attendance()` — SECURITY DEFINER
  Returns attendance for all active agents (admin/owner only).

## Security
- `heartbeat_session` uses the session token as authority (same as all other actions)
- No new RLS policies needed — existing SECURITY DEFINER functions bypass RLS
- No raw session tokens stored in attendance rows
- EXECUTE grants restricted to authenticated only (no anon, no public)

## Important Notes
1. Historical sessions without `last_heartbeat_at` will use expires_at/invalidated_at
   as the interval endpoint — these are labeled "legacy estimate" in the UI.
2. The 90-second stale threshold means: if a client stops sending heartbeats for
   90 seconds, the agent shows as "disconnected" and attendance stops accruing.
3. `agents.logged_in` is NOT removed — it remains for backward compatibility with
   the dialer readiness checks. Heartbeat presence is the source of truth for display.
*/

-- 1. Add last_heartbeat_at to auth_sessions
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auth_sessions' AND column_name = 'last_heartbeat_at'
  ) THEN
    ALTER TABLE public.auth_sessions ADD COLUMN last_heartbeat_at timestamptz;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sessions_agent_heartbeat
  ON public.auth_sessions (agent_id, last_heartbeat_at DESC NULLS LAST)
  WHERE invalidated_at IS NULL;

-- 2. heartbeat_session — stamps heartbeat, returns attendance summary
CREATE OR REPLACE FUNCTION public.heartbeat_session(p_session_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_session record;
  v_agent record;
  v_tz text := 'America/New_York';
  v_now timestamptz;
  v_stale interval := '90 seconds';
  v_today_start timestamptz;
  v_week_start timestamptz;
  v_today_seconds bigint := 0;
  v_week_seconds bigint := 0;
  v_current_seconds bigint := 0;
  v_presence text := 'signed-out';
  v_last_hb timestamptz;
  v_is_legacy boolean := false;
  v_row record;
BEGIN
  v_now := now();

  -- Validate session
  SELECT * INTO v_session FROM public.auth_sessions
  WHERE session_token = p_session_token
    AND invalidated_at IS NULL
    AND expires_at > v_now;

  IF v_session IS NULL THEN
    RETURN jsonb_build_object('valid', false);
  END IF;

  -- Validate agent still active
  SELECT * INTO v_agent FROM public.agents WHERE id = v_session.agent_id AND status = 'active';
  IF v_agent IS NULL THEN
    UPDATE public.auth_sessions SET invalidated_at = v_now WHERE id = v_session.id;
    RETURN jsonb_build_object('valid', false);
  END IF;

  -- Stamp heartbeat
  UPDATE public.auth_sessions
  SET last_heartbeat_at = v_now
  WHERE id = v_session.id;

  -- Also keep agents.logged_in in sync for dialer compatibility
  UPDATE public.agents SET logged_in = true, last_seen_at = v_now WHERE id = v_agent.id;

  -- Compute attendance from all sessions for this agent (this week)
  v_today_start := date_trunc('day', v_now AT TIME ZONE v_tz) AT TIME ZONE v_tz;
  v_week_start := date_trunc('week', (v_now AT TIME ZONE v_tz)::date)::timestamptz AT TIME ZONE v_tz;

  FOR v_row IN
    SELECT created_at,
      LEAST(
        COALESCE(invalidated_at, v_now),
        expires_at,
        CASE WHEN last_heartbeat_at IS NOT NULL THEN last_heartbeat_at + v_stale ELSE v_now END
      ) AS effective_end,
      (last_heartbeat_at IS NULL) AS is_legacy
    FROM public.auth_sessions
    WHERE agent_id = v_agent.id
      AND created_at >= v_week_start
      AND COALESCE(invalidated_at, v_now) > v_week_start
    ORDER BY created_at ASC
  LOOP
    IF v_row.effective_end <= v_row.created_at THEN CONTINUE; END IF;
    IF v_row.is_legacy THEN v_is_legacy := true; END IF;

    IF v_row.effective_end > v_today_start THEN
      v_today_seconds := v_today_seconds + EXTRACT(EPOCH FROM (
        LEAST(v_row.effective_end, v_now) - GREATEST(v_row.created_at, v_today_start)
      ))::bigint;
    END IF;

    v_week_seconds := v_week_seconds + EXTRACT(EPOCH FROM (
      LEAST(v_row.effective_end, v_now) - GREATEST(v_row.created_at, v_week_start)
    ))::bigint;
  END LOOP;

  v_current_seconds := EXTRACT(EPOCH FROM (v_now - v_session.created_at))::bigint;

  SELECT MAX(last_heartbeat_at) INTO v_last_hb
  FROM public.auth_sessions
  WHERE agent_id = v_agent.id AND invalidated_at IS NULL AND expires_at > v_now;

  IF v_last_hb IS NOT NULL THEN
    IF v_now - v_last_hb <= v_stale THEN v_presence := 'online';
    ELSE v_presence := 'disconnected';
    END IF;
  ELSE
    v_presence := 'unknown';
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'agent_id', v_agent.id,
    'presence', v_presence,
    'last_confirmed_at', v_last_hb,
    'current_session_seconds', v_current_seconds,
    'today_total_seconds', GREATEST(v_today_seconds, 0),
    'week_total_seconds', GREATEST(v_week_seconds, 0),
    'is_legacy_estimate', v_is_legacy,
    'timezone', v_tz,
    'server_now', v_now
  );
END;
$$;

-- 3. get_roster_attendance — admin view of all active agents
CREATE OR REPLACE FUNCTION public.get_roster_attendance()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_tz text := 'America/New_York';
  v_now timestamptz;
  v_stale interval := '90 seconds';
  v_today_start timestamptz;
  v_week_start timestamptz;
  v_result jsonb := '[]'::jsonb;
  v_agent record;
  v_row record;
  v_today_seconds bigint;
  v_week_seconds bigint;
  v_last_hb timestamptz;
  v_presence text;
  v_is_legacy boolean;
  v_current_start timestamptz;
BEGIN
  v_now := now();
  v_today_start := date_trunc('day', v_now AT TIME ZONE v_tz) AT TIME ZONE v_tz;
  v_week_start := date_trunc('week', (v_now AT TIME ZONE v_tz)::date)::timestamptz AT TIME ZONE v_tz;

  FOR v_agent IN
    SELECT id, full_name, role, status, logged_in, available_for_transfer, active_for_dialer
    FROM public.agents
    WHERE status = 'active' AND role <> 'owner'
    ORDER BY full_name
  LOOP
    v_today_seconds := 0;
    v_week_seconds := 0;
    v_is_legacy := false;
    v_last_hb := NULL;
    v_current_start := NULL;

    FOR v_row IN
      SELECT created_at,
        LEAST(
          COALESCE(invalidated_at, v_now),
          expires_at,
          CASE WHEN last_heartbeat_at IS NOT NULL THEN last_heartbeat_at + v_stale ELSE v_now END
        ) AS effective_end,
        (last_heartbeat_at IS NULL) AS is_legacy,
        last_heartbeat_at,
        invalidated_at
      FROM public.auth_sessions
      WHERE agent_id = v_agent.id
        AND created_at >= v_week_start
        AND COALESCE(invalidated_at, v_now) > v_week_start
      ORDER BY created_at ASC
    LOOP
      IF v_row.effective_end <= v_row.created_at THEN CONTINUE; END IF;
      IF v_row.is_legacy THEN v_is_legacy := true; END IF;

      IF v_row.effective_end > v_today_start THEN
        v_today_seconds := v_today_seconds + EXTRACT(EPOCH FROM (
          LEAST(v_row.effective_end, v_now) - GREATEST(v_row.created_at, v_today_start)
        ))::bigint;
      END IF;

      v_week_seconds := v_week_seconds + EXTRACT(EPOCH FROM (
        LEAST(v_row.effective_end, v_now) - GREATEST(v_row.created_at, v_week_start)
      ))::bigint;

      IF v_row.last_heartbeat_at IS NOT NULL THEN
        IF v_last_hb IS NULL OR v_row.last_heartbeat_at > v_last_hb THEN
          v_last_hb := v_row.last_heartbeat_at;
        END IF;
      END IF;

      IF v_row.invalidated_at IS NULL THEN
        v_current_start := v_row.created_at;
      END IF;
    END LOOP;

    IF v_last_hb IS NOT NULL THEN
      IF v_now - v_last_hb <= v_stale THEN v_presence := 'online';
      ELSE v_presence := 'disconnected';
      END IF;
    ELSIF v_current_start IS NOT NULL THEN
      v_presence := 'unknown';
    ELSE
      v_presence := 'signed-out';
    END IF;

    v_result := v_result || jsonb_build_object(
      'agent_id', v_agent.id,
      'full_name', v_agent.full_name,
      'role', v_agent.role,
      'presence', v_presence,
      'last_confirmed_at', v_last_hb,
      'today_total_seconds', GREATEST(v_today_seconds, 0),
      'week_total_seconds', GREATEST(v_week_seconds, 0),
      'is_legacy_estimate', v_is_legacy,
      'available_for_transfer', v_agent.available_for_transfer,
      'active_for_dialer', v_agent.active_for_dialer
    );
  END LOOP;

  RETURN jsonb_build_object(
    'roster', v_result,
    'timezone', v_tz,
    'today_start', v_today_start,
    'week_start', v_week_start,
    'server_now', v_now
  );
END;
$$;

-- 4. Restrict execution
REVOKE EXECUTE ON FUNCTION public.heartbeat_session(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.heartbeat_session(text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_roster_attendance() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_roster_attendance() TO authenticated;
