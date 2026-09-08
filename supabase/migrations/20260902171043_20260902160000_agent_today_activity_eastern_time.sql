/*
# Agent Today Activity + Eastern Time Stats

## Changes
1. New function `get_agent_today_activity(p_agent_id)` — returns ALL outbound calls
   for this agent created today in America/New_York time, regardless of queue.
   Each row includes id, consumer_name, consumer_phone, consumer_address,
   queue, transfer_status, duration_seconds, ai_summary, recording_url,
   agent_disposition, is_completed, created_at, call_direction.
   Ordered newest-first.

2. Replaces `get_agent_stats` — now uses Eastern Time (`America/New_York`)
   instead of UTC for the "today" boundary. All counts (human_drops,
   fire_transfers, voice_messages, failed_transfers, callbacks_due,
   completed_callbacks, new_voicemails) now filter on Eastern midnight.
   Adds `active_calls_now` = pending provider calls not yet completed.

## Security
- Both functions are SECURITY DEFINER with search_path = public.
- EXECUTE granted to authenticated only (same as existing pattern).

## Notes
- Eastern Time is the business timezone for this operation.
- `active_calls_now` counts calls with disposition '' or null AND
  duration_seconds = 0 AND created within last 10 minutes — these are
  live pending calls the provider is currently handling.
*/

-- 1. get_agent_today_activity
CREATE OR REPLACE FUNCTION public.get_agent_today_activity(p_agent_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today_start timestamptz;
  v_result jsonb;
BEGIN
  v_today_start := date_trunc('day', now() AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York';

  SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.created_at DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      c.id, c.consumer_name, c.consumer_phone,
      COALESCE(NULLIF(c.consumer_address, ''), NULLIF(l.address, ''), '') AS consumer_address,
      c.queue, c.transfer_status, c.duration_seconds, c.ai_summary,
      c.recording_url, c.agent_disposition, c.is_completed, c.created_at,
      c.call_direction, c.callback_requested, c.agent_notes,
      c.transfer_failure_reason,
      c.originating_bland_number, c.talkroute_destination
    FROM public.calls c
    LEFT JOIN public.leads l ON l.id = c.lead_id
    WHERE c.agent_id = p_agent_id
      AND c.created_at >= v_today_start
    ORDER BY c.created_at DESC
  ) r;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_agent_today_activity(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_agent_today_activity(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_agent_today_activity(uuid) TO authenticated;


-- 2. Replace get_agent_stats with Eastern Time + active_calls_now
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
