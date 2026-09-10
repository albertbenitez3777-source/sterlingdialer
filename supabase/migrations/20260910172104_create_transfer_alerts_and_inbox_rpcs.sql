/*
# Create Transfer Alerts System

## Purpose
Persistent incoming-call alerts and follow-up inbox for agents. When a transfer
is initiated to an agent's Talkroute, we create a transfer_alert row server-side.
The agent sees an overlay, can acknowledge it, record their outcome, and schedule
callbacks. The owner gets a per-agent overview.

## 1. New Table: transfer_alerts
  - id (uuid PK)
  - agent_id (uuid FK→agents) — the assigned agent
  - call_id (uuid FK→calls, nullable) — linked call record
  - lead_id (uuid FK→leads, nullable) — linked lead
  - consumer_name (text) — client name
  - consumer_phone (text) — client phone
  - consumer_email (text) — client email if known
  - consumer_address (text) — client address if known
  - consumer_account_ref (text) — account/reference number
  - consumer_extra (jsonb) — additional client fields (home_value, income_range, etc.)
  - call_direction (text) — 'inbound' or 'outbound'
  - transfer_reason (text) — why the transfer happened
  - transfer_status (text) — 'requested', 'destination_dialed', 'agent_answered', 'bridge_confirmed'
  - agent_outcome (text) — null until agent acts: 'answered', 'missed', 'callback_needed', 'unacknowledged'
  - agent_outcome_at (timestamptz) — when agent recorded outcome
  - agent_notes (text) — free-text notes
  - callback_at (timestamptz) — scheduled callback time
  - callback_completed (boolean) — whether callback was done
  - callback_completed_at (timestamptz)
  - recording_url (text) — when available
  - transcript (text) — when available
  - previous_contacts (jsonb) — previous call history summary
  - is_dismissed (boolean) — agent dismissed the alert
  - created_at (timestamptz)
  - updated_at (timestamptz)

## 2. Security
  - RLS enabled, service_role only (accessed via SECURITY DEFINER RPCs)

## 3. New RPC Functions
  - create_transfer_alert — called by webhook/provider when transfer starts
  - get_agent_alerts — active alerts for an agent
  - get_agent_inbox — full inbox with filters
  - acknowledge_alert — agent records outcome
  - schedule_alert_callback — set callback time
  - complete_callback — mark callback done
  - get_owner_alert_overview — per-agent summary for owner
  - update_alert_evidence — update recording/transcript when available
  - get_alert_detail — full detail for one alert
*/

-- ── TABLE ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.transfer_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id),
  call_id uuid REFERENCES public.calls(id),
  lead_id uuid REFERENCES public.leads(id),
  consumer_name text NOT NULL DEFAULT '',
  consumer_phone text NOT NULL DEFAULT '',
  consumer_email text NOT NULL DEFAULT '',
  consumer_address text NOT NULL DEFAULT '',
  consumer_account_ref text NOT NULL DEFAULT '',
  consumer_extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  call_direction text NOT NULL DEFAULT 'outbound',
  transfer_reason text NOT NULL DEFAULT '',
  transfer_status text NOT NULL DEFAULT 'requested'
    CHECK (transfer_status IN ('requested','destination_dialed','agent_answered','bridge_confirmed')),
  agent_outcome text DEFAULT NULL
    CHECK (agent_outcome IS NULL OR agent_outcome IN ('answered','missed','callback_needed','unacknowledged')),
  agent_outcome_at timestamptz,
  agent_notes text NOT NULL DEFAULT '',
  callback_at timestamptz,
  callback_completed boolean NOT NULL DEFAULT false,
  callback_completed_at timestamptz,
  recording_url text NOT NULL DEFAULT '',
  transcript text NOT NULL DEFAULT '',
  previous_contacts jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_dismissed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.transfer_alerts ENABLE ROW LEVEL SECURITY;

-- Only service_role accesses this table (through SECURITY DEFINER functions)
DROP POLICY IF EXISTS "service_role_all" ON public.transfer_alerts;
CREATE POLICY "service_role_all" ON public.transfer_alerts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_transfer_alerts_agent ON public.transfer_alerts(agent_id);
CREATE INDEX IF NOT EXISTS idx_transfer_alerts_call ON public.transfer_alerts(call_id);
CREATE INDEX IF NOT EXISTS idx_transfer_alerts_active ON public.transfer_alerts(agent_id, is_dismissed, agent_outcome)
  WHERE is_dismissed = false;
CREATE INDEX IF NOT EXISTS idx_transfer_alerts_callbacks ON public.transfer_alerts(agent_id, callback_at)
  WHERE callback_at IS NOT NULL AND callback_completed = false;
CREATE INDEX IF NOT EXISTS idx_transfer_alerts_created ON public.transfer_alerts(created_at DESC);

-- ── RPC: create_transfer_alert ────────────────────────────────────────
-- Called server-side when a transfer event comes in (webhook or provider).
-- Deduplicates on call_id + agent_id to avoid duplicate alerts.
CREATE OR REPLACE FUNCTION public.create_transfer_alert(
  p_agent_id uuid,
  p_call_id uuid DEFAULT NULL,
  p_lead_id uuid DEFAULT NULL,
  p_consumer_name text DEFAULT '',
  p_consumer_phone text DEFAULT '',
  p_consumer_email text DEFAULT '',
  p_consumer_address text DEFAULT '',
  p_consumer_account_ref text DEFAULT '',
  p_consumer_extra jsonb DEFAULT '{}'::jsonb,
  p_call_direction text DEFAULT 'outbound',
  p_transfer_reason text DEFAULT '',
  p_transfer_status text DEFAULT 'requested',
  p_previous_contacts jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id uuid;
  v_alert_id uuid;
BEGIN
  -- Deduplicate: if alert already exists for this call+agent, update status
  IF p_call_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
    FROM transfer_alerts
    WHERE call_id = p_call_id AND agent_id = p_agent_id
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      UPDATE transfer_alerts SET
        transfer_status = CASE
          WHEN p_transfer_status = 'bridge_confirmed' THEN 'bridge_confirmed'
          WHEN p_transfer_status = 'agent_answered' AND transfer_status != 'bridge_confirmed' THEN 'agent_answered'
          WHEN p_transfer_status = 'destination_dialed' AND transfer_status = 'requested' THEN 'destination_dialed'
          ELSE transfer_status
        END,
        consumer_name = CASE WHEN p_consumer_name != '' THEN p_consumer_name ELSE consumer_name END,
        consumer_phone = CASE WHEN p_consumer_phone != '' THEN p_consumer_phone ELSE consumer_phone END,
        consumer_email = CASE WHEN p_consumer_email != '' THEN p_consumer_email ELSE consumer_email END,
        consumer_address = CASE WHEN p_consumer_address != '' THEN p_consumer_address ELSE consumer_address END,
        recording_url = CASE WHEN p_consumer_extra->>'recording_url' IS NOT NULL AND p_consumer_extra->>'recording_url' != ''
                              THEN p_consumer_extra->>'recording_url' ELSE recording_url END,
        transcript = CASE WHEN p_consumer_extra->>'transcript' IS NOT NULL AND p_consumer_extra->>'transcript' != ''
                          THEN p_consumer_extra->>'transcript' ELSE transcript END,
        updated_at = now()
      WHERE id = v_existing_id;
      RETURN jsonb_build_object('success', true, 'alert_id', v_existing_id, 'action', 'updated');
    END IF;
  END IF;

  -- Create new alert
  INSERT INTO transfer_alerts (
    agent_id, call_id, lead_id,
    consumer_name, consumer_phone, consumer_email, consumer_address,
    consumer_account_ref, consumer_extra,
    call_direction, transfer_reason, transfer_status, previous_contacts
  ) VALUES (
    p_agent_id, p_call_id, p_lead_id,
    p_consumer_name, p_consumer_phone, p_consumer_email, p_consumer_address,
    p_consumer_account_ref, p_consumer_extra,
    p_call_direction, p_transfer_reason, p_transfer_status, p_previous_contacts
  )
  RETURNING id INTO v_alert_id;

  RETURN jsonb_build_object('success', true, 'alert_id', v_alert_id, 'action', 'created');
END;
$$;

-- ── RPC: get_agent_alerts ────────────────────────────────────────────
-- Returns active (undismissed, recent) alerts for the overlay.
CREATE OR REPLACE FUNCTION public.get_agent_alerts(p_agent_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alerts jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(a)::jsonb ORDER BY a.created_at DESC), '[]'::jsonb)
  INTO v_alerts
  FROM (
    SELECT
      ta.id, ta.call_id, ta.lead_id,
      ta.consumer_name, ta.consumer_phone, ta.consumer_email,
      ta.consumer_address, ta.consumer_account_ref, ta.consumer_extra,
      ta.call_direction, ta.transfer_reason, ta.transfer_status,
      ta.agent_outcome, ta.agent_notes, ta.callback_at,
      ta.recording_url, ta.transcript, ta.previous_contacts,
      ta.is_dismissed, ta.created_at, ta.updated_at,
      ag.full_name as agent_name,
      ag.talkroute_number as agent_talkroute,
      EXTRACT(EPOCH FROM (now() - ta.created_at))::integer as elapsed_seconds
    FROM transfer_alerts ta
    JOIN agents ag ON ag.id = ta.agent_id
    WHERE ta.agent_id = p_agent_id
      AND ta.is_dismissed = false
      AND ta.created_at > now() - interval '2 hours'
    ORDER BY ta.created_at DESC
    LIMIT 20
  ) a;

  RETURN jsonb_build_object('success', true, 'alerts', v_alerts);
END;
$$;

-- ── RPC: get_agent_inbox ────────────────────────────────────────────
-- Full inbox with category filters.
CREATE OR REPLACE FUNCTION public.get_agent_inbox(
  p_agent_id uuid,
  p_category text DEFAULT 'all',
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_items jsonb;
  v_total integer;
BEGIN
  -- Count total
  SELECT count(*) INTO v_total
  FROM transfer_alerts ta
  WHERE ta.agent_id = p_agent_id
    AND (
      p_category = 'all'
      OR (p_category = 'active' AND ta.is_dismissed = false AND ta.agent_outcome IS NULL)
      OR (p_category = 'answered' AND ta.agent_outcome = 'answered')
      OR (p_category = 'missed' AND ta.agent_outcome = 'missed')
      OR (p_category = 'callbacks' AND ta.callback_at IS NOT NULL AND ta.callback_completed = false)
      OR (p_category = 'overdue' AND ta.callback_at IS NOT NULL AND ta.callback_completed = false AND ta.callback_at < now())
      OR (p_category = 'completed' AND (ta.callback_completed = true OR (ta.agent_outcome IS NOT NULL AND ta.agent_outcome != 'callback_needed')))
      OR (p_category = 'unacknowledged' AND ta.agent_outcome IS NULL AND ta.is_dismissed = false AND ta.created_at < now() - interval '30 minutes')
    );

  SELECT COALESCE(jsonb_agg(row_to_json(a)::jsonb ORDER BY a.sort_key DESC), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      ta.id, ta.call_id, ta.lead_id,
      ta.consumer_name, ta.consumer_phone, ta.consumer_email,
      ta.consumer_address, ta.consumer_account_ref, ta.consumer_extra,
      ta.call_direction, ta.transfer_reason, ta.transfer_status,
      ta.agent_outcome, ta.agent_outcome_at, ta.agent_notes,
      ta.callback_at, ta.callback_completed, ta.callback_completed_at,
      ta.recording_url, ta.transcript, ta.previous_contacts,
      ta.is_dismissed, ta.created_at, ta.updated_at,
      COALESCE(ta.callback_at, ta.created_at) as sort_key
    FROM transfer_alerts ta
    WHERE ta.agent_id = p_agent_id
      AND (
        p_category = 'all'
        OR (p_category = 'active' AND ta.is_dismissed = false AND ta.agent_outcome IS NULL)
        OR (p_category = 'answered' AND ta.agent_outcome = 'answered')
        OR (p_category = 'missed' AND ta.agent_outcome = 'missed')
        OR (p_category = 'callbacks' AND ta.callback_at IS NOT NULL AND ta.callback_completed = false)
        OR (p_category = 'overdue' AND ta.callback_at IS NOT NULL AND ta.callback_completed = false AND ta.callback_at < now())
        OR (p_category = 'completed' AND (ta.callback_completed = true OR (ta.agent_outcome IS NOT NULL AND ta.agent_outcome != 'callback_needed')))
        OR (p_category = 'unacknowledged' AND ta.agent_outcome IS NULL AND ta.is_dismissed = false AND ta.created_at < now() - interval '30 minutes')
      )
    ORDER BY COALESCE(ta.callback_at, ta.created_at) DESC
    LIMIT p_limit OFFSET p_offset
  ) a;

  RETURN jsonb_build_object('success', true, 'items', v_items, 'total', v_total);
END;
$$;

-- ── RPC: acknowledge_alert ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.acknowledge_alert(
  p_alert_id uuid,
  p_agent_id uuid,
  p_outcome text,
  p_notes text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_outcome NOT IN ('answered', 'missed', 'callback_needed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid outcome');
  END IF;

  UPDATE transfer_alerts SET
    agent_outcome = p_outcome,
    agent_outcome_at = now(),
    agent_notes = CASE WHEN p_notes != '' THEN p_notes ELSE agent_notes END,
    is_dismissed = CASE WHEN p_outcome IN ('answered', 'missed') THEN true ELSE is_dismissed END,
    updated_at = now()
  WHERE id = p_alert_id AND agent_id = p_agent_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Alert not found or not yours');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ── RPC: schedule_alert_callback ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.schedule_alert_callback(
  p_alert_id uuid,
  p_agent_id uuid,
  p_callback_at timestamptz,
  p_notes text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE transfer_alerts SET
    agent_outcome = 'callback_needed',
    agent_outcome_at = COALESCE(agent_outcome_at, now()),
    callback_at = p_callback_at,
    callback_completed = false,
    agent_notes = CASE WHEN p_notes != '' THEN p_notes ELSE agent_notes END,
    is_dismissed = true,
    updated_at = now()
  WHERE id = p_alert_id AND agent_id = p_agent_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Alert not found or not yours');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ── RPC: complete_callback ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.complete_callback(
  p_alert_id uuid,
  p_agent_id uuid,
  p_notes text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE transfer_alerts SET
    callback_completed = true,
    callback_completed_at = now(),
    agent_notes = CASE WHEN p_notes != '' THEN p_notes ELSE agent_notes END,
    updated_at = now()
  WHERE id = p_alert_id AND agent_id = p_agent_id AND callback_at IS NOT NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Callback not found');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ── RPC: get_owner_alert_overview ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_owner_alert_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_overview jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(s)::jsonb ORDER BY s.agent_name), '[]'::jsonb)
  INTO v_overview
  FROM (
    SELECT
      ag.id as agent_id,
      ag.full_name as agent_name,
      ag.talkroute_number,
      count(*) FILTER (WHERE ta.created_at > now() - interval '24 hours') as alerts_24h,
      count(*) FILTER (WHERE ta.agent_outcome = 'answered' AND ta.created_at > now() - interval '24 hours') as answered_24h,
      count(*) FILTER (WHERE ta.agent_outcome = 'missed' AND ta.created_at > now() - interval '24 hours') as missed_24h,
      count(*) FILTER (WHERE ta.agent_outcome IS NULL AND ta.is_dismissed = false AND ta.created_at > now() - interval '2 hours') as unacknowledged,
      count(*) FILTER (WHERE ta.callback_at IS NOT NULL AND ta.callback_completed = false) as callbacks_pending,
      count(*) FILTER (WHERE ta.callback_at IS NOT NULL AND ta.callback_completed = false AND ta.callback_at < now()) as callbacks_overdue,
      count(*) FILTER (WHERE ta.agent_outcome = 'answered') as answered_all_time,
      count(*) FILTER (WHERE ta.agent_outcome = 'missed') as missed_all_time,
      count(*) FILTER (WHERE ta.callback_completed = true) as completed_callbacks
    FROM agents ag
    LEFT JOIN transfer_alerts ta ON ta.agent_id = ag.id
    WHERE ag.status = 'active' AND ag.role != 'owner'
    GROUP BY ag.id, ag.full_name, ag.talkroute_number
  ) s;

  RETURN jsonb_build_object('success', true, 'overview', v_overview);
END;
$$;

-- ── RPC: update_alert_evidence ──────────────────────────────────────
-- Called when recording/transcript become available later.
CREATE OR REPLACE FUNCTION public.update_alert_evidence(
  p_call_id uuid,
  p_recording_url text DEFAULT NULL,
  p_transcript text DEFAULT NULL,
  p_transfer_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE transfer_alerts SET
    recording_url = CASE WHEN p_recording_url IS NOT NULL AND p_recording_url != '' THEN p_recording_url ELSE recording_url END,
    transcript = CASE WHEN p_transcript IS NOT NULL AND p_transcript != '' THEN p_transcript ELSE transcript END,
    transfer_status = CASE
      WHEN p_transfer_status = 'bridge_confirmed' THEN 'bridge_confirmed'
      WHEN p_transfer_status = 'agent_answered' AND transfer_status NOT IN ('bridge_confirmed') THEN 'agent_answered'
      WHEN p_transfer_status = 'destination_dialed' AND transfer_status = 'requested' THEN 'destination_dialed'
      ELSE transfer_status
    END,
    updated_at = now()
  WHERE call_id = p_call_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ── RPC: get_alert_detail ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_alert_detail(
  p_alert_id uuid,
  p_agent_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alert jsonb;
  v_call_history jsonb;
BEGIN
  SELECT row_to_json(ta)::jsonb INTO v_alert
  FROM (
    SELECT
      ta.*, ag.full_name as agent_name, ag.talkroute_number as agent_talkroute
    FROM transfer_alerts ta
    JOIN agents ag ON ag.id = ta.agent_id
    WHERE ta.id = p_alert_id AND ta.agent_id = p_agent_id
  ) ta;

  IF v_alert IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Alert not found');
  END IF;

  -- Fetch call history for this consumer
  SELECT COALESCE(jsonb_agg(row_to_json(c)::jsonb ORDER BY c.created_at DESC), '[]'::jsonb)
  INTO v_call_history
  FROM (
    SELECT id, queue, disposition, duration_seconds, created_at, agent_notes,
           transfer_status, bridge_confirmed, recording_url, is_live_human
    FROM calls
    WHERE consumer_phone = (v_alert->>'consumer_phone')
      AND consumer_phone != ''
    ORDER BY created_at DESC
    LIMIT 20
  ) c;

  RETURN jsonb_build_object('success', true, 'alert', v_alert, 'call_history', v_call_history);
END;
$$;

-- Grant execute to service_role only (accessed via wolf-provider with session auth)
DO $$
DECLARE
  v_fn regprocedure;
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'get_agent_alerts', 'get_agent_inbox', 'acknowledge_alert',
      'schedule_alert_callback', 'complete_callback', 'get_owner_alert_overview',
      'update_alert_evidence', 'get_alert_detail'
    )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_fn);
  END LOOP;
END;
$$;
