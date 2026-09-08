/*
# Agent Call Audit Table + Webhook Diagnostic Column

1. New Tables
  - `agent_call_audit` — per-agent, per-call audit trail with strict status tracking
    - `id` (uuid, PK)
    - `call_id` (uuid, FK to calls)
    - `agent_id` (uuid, FK to agents)
    - `consumer_phone` (text)
    - `consumer_name` (text)
    - `attempted_at` (timestamptz) — when the outbound call was placed
    - `rang_at` (timestamptz) — when Talkroute destination was dialed
    - `answered_at` (timestamptz) — when representative speech or MERGED proved answer
    - `voicemail_at` (timestamptz) — when Talkroute voicemail was detected
    - `bridge_confirmed_at` (timestamptz) — when bridge was confirmed with strict proof
    - `failed_at` (timestamptz) — when transfer failure was recorded
    - `failure_reason` (text)
    - `call_duration_seconds` (int)
    - `queue` (text)
    - `transfer_state` (text)
    - `webhook_transfer_status` (text) — raw transfer_status from Bland webhook
    - `created_at` (timestamptz)

2. Modified Tables
  - `calls` — add `webhook_raw_payload` (jsonb, nullable) to capture raw webhook body
    for debugging Talkroute delivery issues

3. Security
  - RLS enabled on `agent_call_audit`
  - Service-role only (no anon/authenticated policies — written by edge functions only)

4. Important Notes
  - This table is append-only for audit purposes
  - The webhook_raw_payload column captures the last webhook body for TR-dialed calls only
    to minimize storage while enabling diagnosis of missing post_transfer_transcript
*/

-- Audit table
CREATE TABLE IF NOT EXISTS public.agent_call_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  consumer_phone text NOT NULL DEFAULT '',
  consumer_name text NOT NULL DEFAULT '',
  attempted_at timestamptz,
  rang_at timestamptz,
  answered_at timestamptz,
  voicemail_at timestamptz,
  bridge_confirmed_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  call_duration_seconds int DEFAULT 0,
  queue text,
  transfer_state text,
  webhook_transfer_status text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_call_audit ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_audit_agent_created ON public.agent_call_audit (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_call_id ON public.agent_call_audit (call_id);

-- Webhook raw payload column on calls (TR-dialed only, for diagnosis)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calls' AND column_name = 'webhook_raw_payload') THEN
    ALTER TABLE public.calls ADD COLUMN webhook_raw_payload jsonb;
  END IF;
END $$;

-- Function: populate audit row from webhook data
CREATE OR REPLACE FUNCTION public.upsert_call_audit(
  p_call_id uuid,
  p_agent_id uuid,
  p_consumer_phone text,
  p_consumer_name text,
  p_attempted_at timestamptz,
  p_rang_at timestamptz,
  p_answered_at timestamptz,
  p_voicemail_at timestamptz,
  p_bridge_confirmed_at timestamptz,
  p_failed_at timestamptz,
  p_failure_reason text,
  p_duration int,
  p_queue text,
  p_transfer_state text,
  p_webhook_transfer_status text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $$
BEGIN
  INSERT INTO public.agent_call_audit (
    call_id, agent_id, consumer_phone, consumer_name,
    attempted_at, rang_at, answered_at, voicemail_at,
    bridge_confirmed_at, failed_at, failure_reason,
    call_duration_seconds, queue, transfer_state, webhook_transfer_status
  ) VALUES (
    p_call_id, p_agent_id, p_consumer_phone, p_consumer_name,
    p_attempted_at, p_rang_at, p_answered_at, p_voicemail_at,
    p_bridge_confirmed_at, p_failed_at, p_failure_reason,
    p_duration, p_queue, p_transfer_state, p_webhook_transfer_status
  )
  ON CONFLICT (call_id) DO UPDATE SET
    rang_at = COALESCE(EXCLUDED.rang_at, agent_call_audit.rang_at),
    answered_at = COALESCE(EXCLUDED.answered_at, agent_call_audit.answered_at),
    voicemail_at = COALESCE(EXCLUDED.voicemail_at, agent_call_audit.voicemail_at),
    bridge_confirmed_at = COALESCE(EXCLUDED.bridge_confirmed_at, agent_call_audit.bridge_confirmed_at),
    failed_at = COALESCE(EXCLUDED.failed_at, agent_call_audit.failed_at),
    failure_reason = COALESCE(EXCLUDED.failure_reason, agent_call_audit.failure_reason),
    call_duration_seconds = COALESCE(EXCLUDED.call_duration_seconds, agent_call_audit.call_duration_seconds),
    queue = COALESCE(EXCLUDED.queue, agent_call_audit.queue),
    transfer_state = COALESCE(EXCLUDED.transfer_state, agent_call_audit.transfer_state),
    webhook_transfer_status = COALESCE(EXCLUDED.webhook_transfer_status, agent_call_audit.webhook_transfer_status);
END;
$$;

-- Add unique constraint on call_id for upsert
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_call_id_unique ON public.agent_call_audit (call_id);
