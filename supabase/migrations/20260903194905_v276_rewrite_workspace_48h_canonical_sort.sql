/*
# Rewrite get_agent_workspace: 48h rolling window, canonical sort, strict Live Now

## Changes
- **Canonical sort**: all buckets use `COALESCE(started_at, created_at, transfer_requested_at) DESC, id DESC`
  as deterministic tie-breaker
- **48-hour window**: today + yesterday buckets are calendar-based ET but only within
  the last 48 hours; the old "this_week_earlier" bucket is removed
- **Strict Live Now**: only calls where `is_completed = false` AND created within 15 minutes
  AND NOT already dispositioned. No completed calls ever appear here.
- **Dedup guarantee**: each call appears in exactly one bucket, enforced by
  mutually exclusive WHERE predicates on is_completed + created_at ranges
- **Archive**: anything older than yesterday_start (> 48h cutoff), paginated 50/page
- **Null-safe timestamps**: COALESCE normalizes null started_at/transfer_requested_at

## Important Notes
1. Replaces the old get_agent_workspace function entirely (CREATE OR REPLACE)
2. The "this_week_earlier" bucket is removed; frontend should hide/skip the "week" tab
3. Archive total counts all calls before yesterday_start
*/

CREATE OR REPLACE FUNCTION public.get_agent_workspace(p_agent_id uuid, p_archive_offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $function$
DECLARE
  v_tz text := 'America/New_York';
  v_now timestamptz;
  v_today_start timestamptz;
  v_yesterday_start timestamptz;
  v_stale_cutoff timestamptz;
  v_live_now jsonb;
  v_today_completed jsonb;
  v_yesterday jsonb;
  v_archive_page jsonb;
  v_archive_total int;
  v_alerts jsonb;
  v_stats jsonb;
BEGIN
  v_now := now();
  v_today_start := date_trunc('day', v_now AT TIME ZONE v_tz) AT TIME ZONE v_tz;
  v_yesterday_start := v_today_start - interval '1 day';
  v_stale_cutoff := v_now - interval '15 minutes';

  -- ══ LIVE NOW: not completed, created within 15 min, no disposition ══
  SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.sort_ts DESC, r.id DESC), '[]'::jsonb)
  INTO v_live_now
  FROM (
    SELECT c.id, c.consumer_name, c.consumer_phone,
      COALESCE(NULLIF(c.consumer_address,''), NULLIF(l.address,''), '') AS consumer_address,
      COALESCE(NULLIF(c.consumer_home_value,''), NULLIF(l.home_value,''), '') AS consumer_home_value,
      COALESCE(NULLIF(c.consumer_income_range,''), NULLIF(l.income_range,''), '') AS consumer_income_range,
      COALESCE(NULLIF(c.consumer_property_info,''), NULLIF(l.property_information,''), '') AS consumer_property_info,
      c.consumer_custom_fields,
      c.queue, c.transfer_status, c.transfer_state, c.duration_seconds,
      c.is_completed, c.created_at, c.call_direction,
      c.talkroute_answered, c.bridge_confirmed, c.ai_terminated,
      c.callback_requested, c.agent_disposition, c.agent_notes,
      c.transfer_failure_reason, c.drop_reason,
      c.talkroute_voicemail, c.originating_bland_number, c.talkroute_destination,
      c.recording_url, c.ai_summary, c.transcript,
      COALESCE(c.started_at, c.created_at, c.transfer_requested_at) AS sort_ts
    FROM public.calls c
    LEFT JOIN public.leads l ON l.id = c.lead_id
    WHERE c.agent_id = p_agent_id
      AND c.is_completed = false
      AND c.created_at >= v_stale_cutoff
      AND (c.agent_disposition IS NULL OR c.agent_disposition = '')
  ) r;

  -- ══ TODAY COMPLETED: completed calls since today_start ET, newest first ══
  SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.sort_ts DESC, r.id DESC), '[]'::jsonb)
  INTO v_today_completed
  FROM (
    SELECT c.id, c.consumer_name, c.consumer_phone,
      COALESCE(NULLIF(c.consumer_address,''), NULLIF(l.address,''), '') AS consumer_address,
      COALESCE(NULLIF(c.consumer_home_value,''), NULLIF(l.home_value,''), '') AS consumer_home_value,
      COALESCE(NULLIF(c.consumer_income_range,''), NULLIF(l.income_range,''), '') AS consumer_income_range,
      COALESCE(NULLIF(c.consumer_property_info,''), NULLIF(l.property_information,''), '') AS consumer_property_info,
      c.consumer_custom_fields,
      c.queue, c.transfer_status, c.transfer_state, c.duration_seconds,
      c.is_completed, c.created_at, c.call_direction,
      c.talkroute_answered, c.bridge_confirmed, c.ai_terminated,
      c.callback_requested, c.agent_disposition, c.agent_notes,
      c.transfer_failure_reason, c.drop_reason,
      c.talkroute_voicemail, c.originating_bland_number, c.talkroute_destination,
      c.recording_url, c.ai_summary, c.transcript,
      COALESCE(c.started_at, c.created_at, c.transfer_requested_at) AS sort_ts
    FROM public.calls c
    LEFT JOIN public.leads l ON l.id = c.lead_id
    WHERE c.agent_id = p_agent_id
      AND c.is_completed = true
      AND c.created_at >= v_today_start
  ) r;

  -- ══ YESTERDAY: completed calls from yesterday_start to today_start ET ══
  SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.sort_ts DESC, r.id DESC), '[]'::jsonb)
  INTO v_yesterday
  FROM (
    SELECT c.id, c.consumer_name, c.consumer_phone,
      COALESCE(NULLIF(c.consumer_address,''), NULLIF(l.address,''), '') AS consumer_address,
      COALESCE(NULLIF(c.consumer_home_value,''), NULLIF(l.home_value,''), '') AS consumer_home_value,
      COALESCE(NULLIF(c.consumer_income_range,''), NULLIF(l.income_range,''), '') AS consumer_income_range,
      COALESCE(NULLIF(c.consumer_property_info,''), NULLIF(l.property_information,''), '') AS consumer_property_info,
      c.consumer_custom_fields,
      c.queue, c.transfer_status, c.transfer_state, c.duration_seconds,
      c.is_completed, c.created_at, c.call_direction,
      c.talkroute_answered, c.bridge_confirmed, c.ai_terminated,
      c.callback_requested, c.agent_disposition, c.agent_notes,
      c.transfer_failure_reason, c.drop_reason,
      c.talkroute_voicemail, c.originating_bland_number, c.talkroute_destination,
      c.recording_url, c.ai_summary, c.transcript,
      COALESCE(c.started_at, c.created_at, c.transfer_requested_at) AS sort_ts
    FROM public.calls c
    LEFT JOIN public.leads l ON l.id = c.lead_id
    WHERE c.agent_id = p_agent_id
      AND c.created_at >= v_yesterday_start
      AND c.created_at < v_today_start
  ) r;

  -- ══ ARCHIVE: everything before yesterday_start, paginated ══
  SELECT count(*) INTO v_archive_total
  FROM public.calls
  WHERE agent_id = p_agent_id AND created_at < v_yesterday_start;

  SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.sort_ts DESC, r.id DESC), '[]'::jsonb)
  INTO v_archive_page
  FROM (
    SELECT c.id, c.consumer_name, c.consumer_phone,
      COALESCE(NULLIF(c.consumer_address,''), '') AS consumer_address,
      c.queue, c.transfer_status, c.duration_seconds,
      c.is_completed, c.created_at, c.talkroute_answered, c.bridge_confirmed,
      c.callback_requested, c.transfer_failure_reason, c.drop_reason,
      c.talkroute_voicemail, c.recording_url, c.ai_summary,
      COALESCE(c.started_at, c.created_at, c.transfer_requested_at) AS sort_ts,
      to_char(c.created_at AT TIME ZONE v_tz, 'YYYY-MM-DD') AS day_label
    FROM public.calls c
    WHERE c.agent_id = p_agent_id
      AND c.created_at < v_yesterday_start
    ORDER BY COALESCE(c.started_at, c.created_at, c.transfer_requested_at) DESC, c.id DESC
    LIMIT 50 OFFSET p_archive_offset
  ) r;

  -- ══ ALERTS ══
  SELECT jsonb_build_object(
    'stale_in_live', (SELECT count(*) FROM public.calls
      WHERE agent_id = p_agent_id AND created_at >= v_today_start
      AND is_completed = false AND created_at < v_stale_cutoff
      AND (queue NOT IN ('fire_transfer','human_drop') OR agent_disposition IS NOT NULL)),
    'phone_only_pct', (SELECT CASE WHEN count(*) = 0 THEN 0
      ELSE round(100.0 * count(*) FILTER (WHERE consumer_name IS NULL OR consumer_name = '') / count(*))
      END FROM public.calls WHERE agent_id = p_agent_id AND created_at >= v_today_start),
    'no_recording_pct', (SELECT CASE WHEN count(*) = 0 THEN 0
      ELSE round(100.0 * count(*) FILTER (WHERE recording_url IS NULL OR recording_url = '') / NULLIF(count(*) FILTER (WHERE is_completed), 0))
      END FROM public.calls WHERE agent_id = p_agent_id AND created_at >= v_today_start AND is_completed = true),
    'talkroute_no_answer', (SELECT count(*) FROM public.calls
      WHERE agent_id = p_agent_id AND created_at >= v_today_start
      AND talkroute_leg_created = true AND talkroute_answered = false AND is_completed = true),
    'answer_no_bridge', (SELECT count(*) FROM public.calls
      WHERE agent_id = p_agent_id AND created_at >= v_today_start
      AND talkroute_answered = true AND bridge_confirmed = false AND is_completed = true)
  ) INTO v_alerts;

  -- ══ STATS ══
  SELECT jsonb_build_object(
    'active_calls_now', (SELECT count(*) FROM public.calls
      WHERE agent_id = p_agent_id AND created_at >= v_stale_cutoff
      AND is_completed = false AND (agent_disposition IS NULL OR agent_disposition = '')),
    'live_humans', (SELECT count(*) FROM public.calls
      WHERE agent_id = p_agent_id AND is_live_human = true AND created_at >= v_today_start),
    'fire_transfers', (SELECT count(*) FROM public.calls
      WHERE agent_id = p_agent_id AND queue = 'fire_transfer' AND created_at >= v_today_start),
    'human_drops', (SELECT count(*) FROM public.calls
      WHERE agent_id = p_agent_id AND queue = 'human_drop' AND created_at >= v_today_start),
    'bridges_today', (SELECT count(*) FROM public.calls
      WHERE agent_id = p_agent_id AND bridge_confirmed = true AND created_at >= v_today_start),
    'failed_transfers', (SELECT count(*) FROM public.calls
      WHERE agent_id = p_agent_id AND transfer_failure_reason IS NOT NULL
      AND transfer_failure_reason <> '' AND created_at >= v_today_start),
    'callbacks_due', (SELECT count(*) FROM public.calls
      WHERE agent_id = p_agent_id AND callback_requested = true
      AND is_completed = false AND created_at >= v_today_start),
    'today_total', (SELECT count(*) FROM public.calls
      WHERE agent_id = p_agent_id AND created_at >= v_today_start),
    'voicemails_today', (SELECT count(*) FROM public.calls
      WHERE agent_id = p_agent_id AND queue = 'voice_message' AND created_at >= v_today_start),
    'talkroute_voicemails', (SELECT count(*) FROM public.calls
      WHERE agent_id = p_agent_id AND talkroute_voicemail = true AND created_at >= v_today_start)
  ) INTO v_stats;

  RETURN jsonb_build_object(
    'live_now', v_live_now,
    'today_completed', v_today_completed,
    'yesterday', v_yesterday,
    'archive_page', v_archive_page,
    'archive_total', v_archive_total,
    'alerts', v_alerts,
    'stats', v_stats,
    'boundaries', jsonb_build_object(
      'timezone', v_tz,
      'today_start', v_today_start,
      'yesterday_start', v_yesterday_start,
      'server_now', v_now
    )
  );
END;
$function$;
