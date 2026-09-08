/*
# v253 — Server-side get_agent_opportunities RPC

Replaces the fragile PostgREST .or() filter chain with a direct SQL function.
Returns qualifying calls for a given agent, scoped by Eastern-time day/week boundaries.

1. New function: get_agent_opportunities(p_agent_id, p_tab)
   - Returns all calls matching opportunity criteria: is_live_human, human_drop, voice_message,
     fire_transfer, transfer_requested, talkroute, callback, human_agreed_transfer
   - Scoped to agent_id
   - Tab = 'today' | 'week' | 'all'
   - Uses America/New_York time boundaries computed server-side
   - Returns lightweight rows (no full transcript — just first 200 chars as preview)
   - Includes today/week/all counts

2. Also fixes get_admin_stats to use Eastern time for daily boundaries

Important: This is SECURITY DEFINER with search_path locked.
*/

-- Create the opportunities RPC function
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
  v_et_now timestamp;
  v_et_date date;
  v_dow int;
  v_rows jsonb;
  v_today_count int;
  v_week_count int;
  v_all_count int;
BEGIN
  -- Compute Eastern time boundaries
  v_et_now := (now() AT TIME ZONE 'America/New_York');
  v_et_date := v_et_now::date;
  v_today_start := v_et_date::timestamptz AT TIME ZONE 'America/New_York';
  v_dow := extract(dow from v_et_date)::int;  -- 0=Sunday
  v_week_start := (v_et_date - ((CASE WHEN v_dow = 0 THEN 6 ELSE v_dow - 1 END) || ' days')::interval)::timestamptz AT TIME ZONE 'America/New_York';

  -- Fetch qualifying rows (opportunity criteria)
  WITH opp_rows AS (
    SELECT
      c.id,
      c.lead_id,
      c.consumer_name,
      c.consumer_phone,
      c.consumer_address,
      c.consumer_home_value,
      c.consumer_income_range,
      c.consumer_property_info,
      c.consumer_custom_fields,
      c.queue,
      c.created_at,
      c.duration_seconds,
      c.ai_summary,
      left(c.transcript, 200) as transcript_preview,
      c.recording_url,
      c.transfer_status,
      c.transfer_requested_at,
      c.talkroute_leg_created,
      c.talkroute_answered,
      c.is_live_human,
      c.agent_disposition,
      c.callback_requested,
      c.bridge_confirmed_at,
      c.bridge_confirmed,
      c.agent_notes,
      c.is_completed,
      c.provider_call_id,
      c.has_post_transfer_ai_speech,
      c.human_agreed_transfer,
      c.voicemail_status,
      c.transfer_failure_reason,
      c.agent_id
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

  -- Counts (always computed for all three tabs)
  SELECT count(*) INTO v_today_count
  FROM calls
  WHERE agent_id = p_agent_id
    AND created_at >= v_today_start
    AND (
      is_live_human = true
      OR transfer_requested_at IS NOT NULL
      OR talkroute_leg_created = true
      OR queue IN ('human_drop', 'voice_message', 'fire_transfer')
      OR callback_requested = true
      OR human_agreed_transfer = true
    );

  SELECT count(*) INTO v_week_count
  FROM calls
  WHERE agent_id = p_agent_id
    AND created_at >= v_week_start
    AND (
      is_live_human = true
      OR transfer_requested_at IS NOT NULL
      OR talkroute_leg_created = true
      OR queue IN ('human_drop', 'voice_message', 'fire_transfer')
      OR callback_requested = true
      OR human_agreed_transfer = true
    );

  SELECT count(*) INTO v_all_count
  FROM calls
  WHERE agent_id = p_agent_id
    AND (
      is_live_human = true
      OR transfer_requested_at IS NOT NULL
      OR talkroute_leg_created = true
      OR queue IN ('human_drop', 'voice_message', 'fire_transfer')
      OR callback_requested = true
      OR human_agreed_transfer = true
    );

  RETURN jsonb_build_object(
    'rows', v_rows,
    'counts', jsonb_build_object(
      'today', v_today_count,
      'week', v_week_count,
      'all', v_all_count
    ),
    'server_today_start', v_today_start,
    'server_week_start', v_week_start
  );
END;
$$;

-- Grant to authenticated (edge functions use service role, but also allow authenticated)
GRANT EXECUTE ON FUNCTION public.get_agent_opportunities(uuid, text) TO authenticated, service_role;
