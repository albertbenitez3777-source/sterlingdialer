/*
# Add weekly agent login hours tracking function

## Purpose
Creates a SQL function `get_agent_login_hours()` that returns each agent's
total logged-in time for the current week (resets every Monday at 00:00 UTC),
their current session status, and when they first logged in this week.

## How it works
- Sums session durations from `auth_sessions` where `created_at >= date_trunc('week', NOW())`
- Duration for active sessions = NOW() - created_at (still counting up)
- Duration for ended sessions = invalidated_at - created_at
- Returns: agent_id, full_name, is_logged_in, current_session_start,
  week_total_seconds, today_total_seconds, session_count, first_login_this_week
- Excludes the owner role (only tracks real agents)

## Tables affected
- No new tables. Reads from `auth_sessions` and `agents`.
- Creates a new function `get_agent_login_hours()`.

## Security
- No RLS changes. This is a read-only SECURITY DEFINER function callable by the app.
*/

CREATE OR REPLACE FUNCTION get_agent_login_hours()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
BEGIN
  SELECT json_agg(row_to_json(t)) INTO result
  FROM (
    SELECT
      a.id AS agent_id,
      a.full_name,
      a.logged_in AS is_logged_in,
      a.role,
      -- Current session start (most recent active session)
      (
        SELECT s.created_at
        FROM auth_sessions s
        WHERE s.agent_id = a.id
          AND s.invalidated_at IS NULL
          AND s.expires_at > NOW()
        ORDER BY s.created_at DESC
        LIMIT 1
      ) AS current_session_start,
      -- Total seconds logged in this week (Monday 00:00 UTC reset)
      COALESCE((
        SELECT SUM(
          EXTRACT(EPOCH FROM (
            LEAST(COALESCE(s.invalidated_at, NOW()), NOW()) -
            GREATEST(s.created_at, date_trunc('week', NOW()))
          ))
        )::int
        FROM auth_sessions s
        WHERE s.agent_id = a.id
          AND s.created_at < COALESCE(s.invalidated_at, NOW())
          AND COALESCE(s.invalidated_at, NOW()) > date_trunc('week', NOW())
      ), 0) AS week_total_seconds,
      -- Total seconds logged in today
      COALESCE((
        SELECT SUM(
          EXTRACT(EPOCH FROM (
            LEAST(COALESCE(s.invalidated_at, NOW()), NOW()) -
            GREATEST(s.created_at, date_trunc('day', NOW()))
          ))
        )::int
        FROM auth_sessions s
        WHERE s.agent_id = a.id
          AND s.created_at < COALESCE(s.invalidated_at, NOW())
          AND COALESCE(s.invalidated_at, NOW()) > date_trunc('day', NOW())
      ), 0) AS today_total_seconds,
      -- Number of login sessions this week
      (
        SELECT count(*)
        FROM auth_sessions s
        WHERE s.agent_id = a.id
          AND s.created_at >= date_trunc('week', NOW())
      ) AS session_count,
      -- First login this week
      (
        SELECT min(s.created_at)
        FROM auth_sessions s
        WHERE s.agent_id = a.id
          AND s.created_at >= date_trunc('week', NOW())
      ) AS first_login_this_week
    FROM agents a
    WHERE a.role != 'owner'
      AND a.status = 'active'
    ORDER BY a.full_name
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;
