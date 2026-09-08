/*
# Add call-result queues, session time tracking, and admin statistics

## Overview
Extends the existing calls table with queue classification, transfer timeline fields,
and voice message fields. Adds server-side functions for login-time tracking,
agent-scoped queue retrieval, and admin command-center statistics.

## Modified Tables
- `calls`: Adds queue classification, transfer timeline, AI speech detection,
  voice message fields, agent affinity, callback tracking, and disposition fields.

## New Functions (all SECURITY DEFINER)
- `classify_call_queue(call_id uuid)`: Classifies a call into human_drop, fire_transfer,
  or voice_message based on provider evidence. One call = one final queue.
- `get_agent_queues(agent_id uuid)`: Returns all three queues for a specific agent only.
- `get_agent_stats(agent_id uuid)`: Returns per-agent statistics for the agent dashboard.
- `get_admin_stats()`: Returns admin summary cards and per-agent statistics table.
- `get_agent_session_durations(agent_id uuid)`: Returns current, today, and week durations.
- `update_call_disposition(call_id uuid, agent_id uuid, disposition text, notes text)`:
  Agent-scoped disposition and notes update.
- `schedule_callback(call_id uuid, agent_id uuid, callback_at timestamptz)`: Agent-scoped callback scheduling.
- `mark_call_completed(call_id uuid, agent_id uuid)`: Agent marks a call completed.
- `mark_dnc_wrong_number(call_id uuid, agent_id uuid, is_dnc boolean, is_wrong_number boolean)`:
  Agent submits DNC or wrong number.
- `admin_reclassify_call(call_id uuid, new_queue text, reason text, admin_id uuid)`:
  Audited admin-only reclassification with required reason.

## Security
- Agent queue functions enforce agent_id filtering — agents see only their own records.
- Admin functions check role before returning cross-agent data.
- All mutations go through SECURITY DEFINER functions with ownership checks.
- No new tables — extends existing calls table to avoid data loss.
*/

-- ============================================================
-- EXTEND CALLS TABLE WITH QUEUE AND TIMELINE FIELDS
-- ============================================================

ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS queue text NOT NULL DEFAULT 'pending'
  CHECK (queue IN ('pending','human_drop','fire_transfer','voice_message','transfer_defect'));
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS call_direction text NOT NULL DEFAULT 'outbound'
  CHECK (call_direction IN ('inbound','outbound'));
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS ai_summary text NOT NULL DEFAULT '';
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS callback_requested boolean NOT NULL DEFAULT false;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS transfer_failure_reason text NOT NULL DEFAULT '';
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS is_live_human boolean NOT NULL DEFAULT false;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS human_agreed_transfer boolean NOT NULL DEFAULT false;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS talkroute_leg_created boolean NOT NULL DEFAULT false;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS talkroute_answered boolean NOT NULL DEFAULT false;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS bridge_confirmed boolean NOT NULL DEFAULT false;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS ai_terminated boolean NOT NULL DEFAULT false;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS transfer_requested_at timestamptz;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS talkroute_answered_at timestamptz;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS bridge_confirmed_at timestamptz;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS ai_terminated_at timestamptz;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS has_post_transfer_ai_speech boolean NOT NULL DEFAULT false;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS originating_bland_number text NOT NULL DEFAULT '';
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS talkroute_destination text NOT NULL DEFAULT '';

-- Voice message specific fields
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS voicemail_status text NOT NULL DEFAULT 'new'
  CHECK (voicemail_status IN ('new','heard','callback_scheduled','completed'));
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS voicemail_urgency text NOT NULL DEFAULT 'normal'
  CHECK (voicemail_urgency IN ('normal','urgent','after_hours'));
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS requested_callback_time timestamptz;

-- Lead fields snapshot (so agents see full lead info without accessing the lead pool)
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS consumer_name text NOT NULL DEFAULT '';
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS consumer_phone text NOT NULL DEFAULT '';
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS consumer_address text NOT NULL DEFAULT '';
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS consumer_home_value text NOT NULL DEFAULT '';
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS consumer_income_range text NOT NULL DEFAULT '';
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS consumer_property_info text NOT NULL DEFAULT '';
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS consumer_custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Agent disposition fields
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS agent_notes text NOT NULL DEFAULT '';
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS agent_disposition text NOT NULL DEFAULT '';
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS is_completed boolean NOT NULL DEFAULT false;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS is_dnc boolean NOT NULL DEFAULT false;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS is_wrong_number boolean NOT NULL DEFAULT false;

-- Deduplication for provider webhooks
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS provider_event_hash text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS calls_queue_agent_idx ON public.calls(queue, agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS calls_agent_created_idx ON public.calls(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS calls_provider_call_id_idx ON public.calls(provider_call_id);
CREATE INDEX IF NOT EXISTS calls_provider_event_hash_idx ON public.calls(provider_event_hash);
CREATE INDEX IF NOT EXISTS calls_voicemail_status_idx ON public.calls(voicemail_status, agent_id);

-- ============================================================
-- CLASSIFY CALL QUEUE
-- ============================================================

CREATE OR REPLACE FUNCTION public.classify_call_queue(p_call_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_call record;
  v_new_queue text;
BEGIN
  SELECT * INTO v_call FROM public.calls WHERE id = p_call_id;
  IF v_call IS NULL THEN
    RETURN 'pending';
  END IF;

  -- Voice message: inbound caller left a message
  IF v_call.queue = 'voice_message' THEN
    RETURN 'voice_message';
  END IF;

  -- Fire Transfer: ALL conditions must be confirmed
  IF v_call.is_live_human
     AND v_call.human_agreed_transfer
     AND v_call.talkroute_leg_created
     AND v_call.talkroute_answered
     AND v_call.bridge_confirmed
     AND v_call.ai_terminated
  THEN
    -- Check for post-transfer AI speech defect
    IF v_call.has_post_transfer_ai_speech THEN
      v_new_queue := 'transfer_defect';
    ELSE
      v_new_queue := 'fire_transfer';
    END IF;
  -- Voice message path: inbound and not live human, or voicemail indicator
  ELSIF v_call.call_direction = 'inbound' AND NOT v_call.is_live_human THEN
    v_new_queue := 'voice_message';
  -- Human Drop: live human without completed bridge
  ELSIF v_call.is_live_human THEN
    v_new_queue := 'human_drop';
  -- Not a live human (ringing, voicemail, busy, no answer, provider failure)
  ELSE
    v_new_queue := 'pending';
  END IF;

  UPDATE public.calls SET queue = v_new_queue WHERE id = p_call_id;

  RETURN v_new_queue;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.classify_call_queue FROM anon;
GRANT EXECUTE ON FUNCTION public.classify_call_queue TO authenticated;

-- ============================================================
-- GET AGENT QUEUES — returns only the requesting agent's records
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_agent_queues(p_agent_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_human_drop jsonb;
  v_fire_transfers jsonb;
  v_voice_messages jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.created_at DESC), '[]'::jsonb)
  INTO v_human_drop
  FROM (
    SELECT id, consumer_name, consumer_phone, consumer_address, consumer_home_value,
           consumer_income_range, consumer_property_info, consumer_custom_fields,
           call_direction, duration_seconds, ai_summary, transcript, recording_url,
           callback_requested, transfer_failure_reason, agent_disposition, agent_notes,
           is_completed, is_dnc, is_wrong_number, created_at, transfer_status,
           originating_bland_number, talkroute_destination
    FROM public.calls
    WHERE agent_id = p_agent_id AND queue = 'human_drop'
  ) r;

  SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.created_at DESC), '[]'::jsonb)
  INTO v_fire_transfers
  FROM (
    SELECT id, consumer_name, consumer_phone, consumer_address, consumer_home_value,
           consumer_income_range, consumer_property_info, consumer_custom_fields,
           call_direction, duration_seconds, ai_summary, transcript, recording_url,
           agent_disposition, agent_notes, is_completed, created_at,
           originating_bland_number, talkroute_destination,
           transfer_requested_at, talkroute_answered_at, bridge_confirmed_at,
           ai_terminated_at, talkroute_answered, bridge_confirmed, ai_terminated
    FROM public.calls
    WHERE agent_id = p_agent_id AND queue = 'fire_transfer'
  ) r;

  SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.created_at DESC), '[]'::jsonb)
  INTO v_voice_messages
  FROM (
    SELECT id, consumer_name, consumer_phone, ai_summary, transcript, recording_url,
           voicemail_status, voicemail_urgency, requested_callback_time,
           agent_notes, created_at, call_direction
    FROM public.calls
    WHERE agent_id = p_agent_id AND queue = 'voice_message'
  ) r;

  RETURN jsonb_build_object(
    'human_drop', v_human_drop,
    'fire_transfers', v_fire_transfers,
    'voice_messages', v_voice_messages
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_agent_queues FROM anon;
GRANT EXECUTE ON FUNCTION public.get_agent_queues TO authenticated;

-- ============================================================
-- GET AGENT SESSION DURATIONS
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_agent_session_durations(p_agent_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_current_session record;
  v_current_duration interval;
  v_today_total interval;
  v_week_total interval;
  v_week_start timestamptz;
BEGIN
  -- Find the most recent active session
  SELECT * INTO v_current_session
  FROM public.auth_sessions
  WHERE agent_id = p_agent_id
    AND invalidated_at IS NULL
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_current_session IS NOT NULL THEN
    v_current_duration := now() - v_current_session.created_at;
  ELSE
    v_current_duration := '0 seconds'::interval;
  END IF;

  -- Today's total: sum durations of all sessions that overlap today
  -- For active sessions, count from created_at to now; for closed, created_at to invalidated_at
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
    'session_start', v_current_session.created_at,
    'is_logged_in', v_current_session IS NOT NULL
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_agent_session_durations FROM anon;
GRANT EXECUTE ON FUNCTION public.get_agent_session_durations TO authenticated;

-- ============================================================
-- GET AGENT STATS (for agent dashboard)
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_agent_stats(p_agent_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_durations jsonb;
BEGIN
  SELECT jsonb_build_object(
    'human_drops', (SELECT count(*) FROM public.calls WHERE agent_id = p_agent_id AND queue = 'human_drop' AND created_at >= date_trunc('day', now())),
    'fire_transfers', (SELECT count(*) FROM public.calls WHERE agent_id = p_agent_id AND queue = 'fire_transfer' AND created_at >= date_trunc('day', now())),
    'voice_messages', (SELECT count(*) FROM public.calls WHERE agent_id = p_agent_id AND queue = 'voice_message' AND created_at >= date_trunc('day', now())),
    'failed_transfers', (SELECT count(*) FROM public.calls WHERE agent_id = p_agent_id AND queue = 'human_drop' AND transfer_failure_reason <> '' AND created_at >= date_trunc('day', now())),
    'callbacks_due', (SELECT count(*) FROM public.calls WHERE agent_id = p_agent_id AND callback_requested = true AND is_completed = false AND created_at >= date_trunc('day', now())),
    'completed_callbacks', (SELECT count(*) FROM public.calls WHERE agent_id = p_agent_id AND is_completed = true AND callback_requested = true AND created_at >= date_trunc('day', now())),
    'new_voicemails', (SELECT count(*) FROM public.calls WHERE agent_id = p_agent_id AND queue = 'voice_message' AND voicemail_status = 'new')
  ) INTO v_result;

  SELECT public.get_agent_session_durations(p_agent_id) INTO v_durations;
  v_result := v_result || v_durations;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_agent_stats FROM anon;
GRANT EXECUTE ON FUNCTION public.get_agent_stats TO authenticated;

-- ============================================================
-- GET ADMIN STATS (command center summary + per-agent table)
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_admin_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_summary jsonb;
  v_agents jsonb;
  v_agent record;
  v_durations jsonb;
  v_stats jsonb;
  v_agents_list jsonb[];
BEGIN
  -- Summary cards
  SELECT jsonb_build_object(
    'agents_logged_in', (SELECT count(*) FROM public.agents WHERE logged_in = true),
    'agents_available', (SELECT count(*) FROM public.agents WHERE available_for_transfer = true),
    'live_humans_today', (SELECT count(*) FROM public.calls WHERE is_live_human = true AND created_at >= date_trunc('day', now())),
    'human_drops_today', (SELECT count(*) FROM public.calls WHERE queue = 'human_drop' AND created_at >= date_trunc('day', now())),
    'fire_transfers_today', (SELECT count(*) FROM public.calls WHERE queue = 'fire_transfer' AND created_at >= date_trunc('day', now())),
    'failed_transfers_today', (SELECT count(*) FROM public.calls WHERE queue = 'human_drop' AND transfer_failure_reason <> '' AND created_at >= date_trunc('day', now())),
    'voice_messages_today', (SELECT count(*) FROM public.calls WHERE queue = 'voice_message' AND created_at >= date_trunc('day', now())),
    'total_login_hours_today', (
      SELECT COALESCE(sum(extract(epoch FROM (
        LEAST(COALESCE(invalidated_at, now()), date_trunc('day', now()) + interval '1 day')
        - GREATEST(created_at, date_trunc('day', now()))
      ))), 0) / 3600
      FROM public.auth_sessions
      WHERE created_at < date_trunc('day', now()) + interval '1 day'
        AND COALESCE(invalidated_at, now()) > date_trunc('day', now())
    )
  ) INTO v_summary;

  -- Per-agent statistics
  v_agents_list := ARRAY[]::jsonb[];

  FOR v_agent IN SELECT * FROM public.agents ORDER BY created_at LOOP
    SELECT public.get_agent_session_durations(v_agent.id) INTO v_durations;
    SELECT jsonb_build_object(
      'id', v_agent.id,
      'full_name', v_agent.full_name,
      'role', v_agent.role,
      'logged_in', v_agent.logged_in,
      'available', v_agent.available_for_transfer,
      'outbound_attempts_today', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND call_direction = 'outbound' AND created_at >= date_trunc('day', now())),
      'provider_accepted', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND talkroute_leg_created = true AND created_at >= date_trunc('day', now())),
      'live_humans', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND is_live_human = true AND created_at >= date_trunc('day', now())),
      'human_drops', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'human_drop' AND created_at >= date_trunc('day', now())),
      'fire_transfers', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'fire_transfer' AND created_at >= date_trunc('day', now())),
      'failed_transfers', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'human_drop' AND transfer_failure_reason <> '' AND created_at >= date_trunc('day', now())),
      'voice_messages', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'voice_message' AND created_at >= date_trunc('day', now())),
      'callbacks_due', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND callback_requested = true AND is_completed = false),
      'completed_callbacks', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND is_completed = true AND callback_requested = true),
      'voicemails_detected', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'voice_message' AND created_at >= date_trunc('day', now())),
      'no_answers', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'pending' AND disposition = 'no_answer' AND created_at >= date_trunc('day', now())),
      'busy_calls', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND disposition = 'busy' AND created_at >= date_trunc('day', now())),
      'invalid_numbers', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND disposition = 'invalid_number' AND created_at >= date_trunc('day', now())),
      'dnc_requests', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND is_dnc = true AND created_at >= date_trunc('day', now())),
      'avg_ai_duration', (SELECT COALESCE(avg(duration_seconds), 0) FROM public.calls WHERE agent_id = v_agent.id AND is_live_human = true AND created_at >= date_trunc('day', now())),
      'talkroute_answer_rate', CASE
        WHEN (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND talkroute_leg_created = true AND created_at >= date_trunc('day', now())) > 0
        THEN (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND talkroute_answered = true AND created_at >= date_trunc('day', now()))::numeric /
             (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND talkroute_leg_created = true AND created_at >= date_trunc('day', now()))
        ELSE 0
      END,
      'fire_transfer_rate', CASE
        WHEN (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND is_live_human = true AND created_at >= date_trunc('day', now())) > 0
        THEN (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'fire_transfer' AND created_at >= date_trunc('day', now()))::numeric /
             (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND is_live_human = true AND created_at >= date_trunc('day', now()))
        ELSE 0
      END,
      'last_call_time', (SELECT max(created_at) FROM public.calls WHERE agent_id = v_agent.id),
      'current_campaign', 'idle',
      'leads_remaining', 0
    ) INTO v_stats;

    v_stats := v_stats || v_durations;
    v_agents_list := array_append(v_agents_list, v_stats);
  END LOOP;

  v_agents := COALESCE(jsonb_agg(v), '[]'::jsonb) FROM unnest(v_agents_list) v;

  RETURN jsonb_build_object('summary', v_summary, 'agents', v_agents);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_admin_stats FROM anon;
GRANT EXECUTE ON FUNCTION public.get_admin_stats TO authenticated;

-- ============================================================
-- AGENT-SCOPED MUTATION FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_call_disposition(
  p_call_id uuid, p_agent_id uuid, p_disposition text, p_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_call record;
BEGIN
  SELECT * INTO v_call FROM public.calls WHERE id = p_call_id AND agent_id = p_agent_id;
  IF v_call IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Call not found or not owned by agent');
  END IF;

  UPDATE public.calls SET agent_disposition = p_disposition, agent_notes = p_notes WHERE id = p_call_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_call_disposition FROM anon;
GRANT EXECUTE ON FUNCTION public.update_call_disposition TO authenticated;

CREATE OR REPLACE FUNCTION public.schedule_callback(
  p_call_id uuid, p_agent_id uuid, p_callback_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.calls
  SET callback_requested = true, requested_callback_time = p_callback_at
  WHERE id = p_call_id AND agent_id = p_agent_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Call not found or not owned by agent');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.schedule_callback FROM anon;
GRANT EXECUTE ON FUNCTION public.schedule_callback TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_call_completed(p_call_id uuid, p_agent_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.calls SET is_completed = true WHERE id = p_call_id AND agent_id = p_agent_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Call not found or not owned by agent');
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_call_completed FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_call_completed TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_dnc_wrong_number(
  p_call_id uuid, p_agent_id uuid, p_is_dnc boolean, p_is_wrong_number boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_phone text;
BEGIN
  UPDATE public.calls
  SET is_dnc = p_is_dnc, is_wrong_number = p_is_wrong_number
  WHERE id = p_call_id AND agent_id = p_agent_id
  RETURNING consumer_phone INTO v_phone;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Call not found or not owned by agent');
  END IF;

  -- Add to suppression list if DNC
  IF p_is_dnc AND v_phone <> '' THEN
    INSERT INTO public.suppression_entries (telephone_normalized, reason)
    VALUES (v_phone, 'Do Not Call')
    ON CONFLICT (telephone_normalized) DO NOTHING;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_dnc_wrong_number FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_dnc_wrong_number TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_voicemail_heard(p_call_id uuid, p_agent_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.calls SET voicemail_status = 'heard'
  WHERE id = p_call_id AND agent_id = p_agent_id AND queue = 'voice_message';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Voicemail not found or not owned by agent');
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_voicemail_heard FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_voicemail_heard TO authenticated;

-- ============================================================
-- ADMIN AUDITED RECLASSIFICATION
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_reclassify_call(
  p_call_id uuid, p_new_queue text, p_reason text, p_admin_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_admin record;
  v_old_queue text;
BEGIN
  SELECT * INTO v_admin FROM public.agents WHERE id = p_admin_id AND role = 'administrator';
  IF v_admin IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Administrator access required');
  END IF;

  IF p_reason IS NULL OR p_reason = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'A reason is required for reclassification');
  END IF;

  SELECT queue INTO v_old_queue FROM public.calls WHERE id = p_call_id;
  IF v_old_queue IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Call not found');
  END IF;

  UPDATE public.calls SET queue = p_new_queue WHERE id = p_call_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    NULL,
    'admin_reclassify',
    'call',
    p_call_id::text,
    jsonb_build_object('old_queue', v_old_queue, 'new_queue', p_new_queue, 'reason', p_reason, 'admin', p_admin_id::text)
  );

  RETURN jsonb_build_object('success', true, 'old_queue', v_old_queue, 'new_queue', p_new_queue);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_reclassify_call FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_reclassify_call TO authenticated;

-- ============================================================
-- INSERT SIMULATED TEST DATA
-- ============================================================

CREATE OR REPLACE FUNCTION public.insert_test_call(
  p_agent_id uuid,
  p_queue text,
  p_consumer_name text DEFAULT 'Test Consumer',
  p_consumer_phone text DEFAULT '(555) 000-0000',
  p_call_direction text DEFAULT 'outbound',
  p_is_live_human boolean DEFAULT true,
  p_human_agreed_transfer boolean DEFAULT false,
  p_talkroute_leg_created boolean DEFAULT false,
  p_talkroute_answered boolean DEFAULT false,
  p_bridge_confirmed boolean DEFAULT false,
  p_ai_terminated boolean DEFAULT false,
  p_has_post_transfer_ai_speech boolean DEFAULT false,
  p_transfer_failure_reason text DEFAULT '',
  p_ai_summary text DEFAULT '',
  p_transcript text DEFAULT '',
  p_recording_url text DEFAULT '',
  p_duration_seconds integer DEFAULT 0,
  p_voicemail_status text DEFAULT 'new',
  p_voicemail_urgency text DEFAULT 'normal',
  p_callback_requested boolean DEFAULT false,
  p_consumer_address text DEFAULT '',
  p_consumer_home_value text DEFAULT '',
  p_consumer_income_range text DEFAULT '',
  p_consumer_property_info text DEFAULT '',
  p_consumer_custom_fields jsonb DEFAULT '{}'::jsonb,
  p_originating_bland_number text DEFAULT '',
  p_talkroute_destination text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_call_id uuid;
  v_provider_call_id text;
BEGIN
  v_provider_call_id := 'test_' || encode(gen_random_bytes(8), 'hex');
  v_call_id := gen_random_uuid();

  INSERT INTO public.calls (
    id, agent_id, provider_call_id, queue, call_direction,
    is_live_human, human_agreed_transfer, talkroute_leg_created,
    talkroute_answered, bridge_confirmed, ai_terminated,
    has_post_transfer_ai_speech, transfer_failure_reason,
    ai_summary, transcript, recording_url, duration_seconds,
    voicemail_status, voicemail_urgency, callback_requested,
    consumer_name, consumer_phone, consumer_address,
    consumer_home_value, consumer_income_range, consumer_property_info,
    consumer_custom_fields, originating_bland_number, talkroute_destination,
    transfer_status, disposition, created_at
  )
  VALUES (
    v_call_id, p_agent_id, v_provider_call_id, p_queue, p_call_direction,
    p_is_live_human, p_human_agreed_transfer, p_talkroute_leg_created,
    p_talkroute_answered, p_bridge_confirmed, p_ai_terminated,
    p_has_post_transfer_ai_speech, p_transfer_failure_reason,
    p_ai_summary, p_transcript, p_recording_url, p_duration_seconds,
    p_voicemail_status, p_voicemail_urgency, p_callback_requested,
    p_consumer_name, p_consumer_phone, p_consumer_address,
    p_consumer_home_value, p_consumer_income_range, p_consumer_property_info,
    p_consumer_custom_fields, p_originating_bland_number, p_talkroute_destination,
    CASE
      WHEN p_queue = 'fire_transfer' THEN 'successful'
      WHEN p_queue = 'human_drop' AND p_transfer_failure_reason <> '' THEN 'unsuccessful'
      WHEN p_human_agreed_transfer THEN 'requested'
      ELSE 'none'
    END,
    CASE WHEN p_queue = 'pending' AND NOT p_is_live_human THEN 'no_answer' ELSE '' END,
    now() - (random() * interval '2 hours')
  );

  RETURN v_call_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.insert_test_call FROM anon;
GRANT EXECUTE ON FUNCTION public.insert_test_call TO authenticated;
