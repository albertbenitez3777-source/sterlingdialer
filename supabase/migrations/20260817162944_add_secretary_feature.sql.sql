/*
# Secretary Feature — call-out table + custom message privilege

1. New Tables
- `secretary_calls` — tracks each secretary-initiated call
  - `id` uuid PK
  - `agent_id` uuid FK → agents(id)
  - `client_name` text — name of the person to call
  - `client_phone` text — normalized E.164 phone number
  - `mode` text — 'reminder' or 'transfer'
  - `custom_message` text — agent's typed message (optional, nullable)
  - `status` text — lifecycle: 'pending', 'dialing', 'ringing', 'answered', 'transferred', 'voicemail_left', 'no_answer', 'failed', 'dnc_blocked', 'completed'
  - `provider_call_id` text — Bland.ai call ID (nullable)
  - `transfer_status` text — 'pending', 'bridged', 'failed' (nullable)
  - `transcript` text — full call transcript (nullable)
  - `recording_url` text — Bland recording URL (nullable)
  - `ai_summary` text — Bland summary (nullable)
  - `error_message` text — failure reason (nullable)
  - `duration_seconds` integer default 0
  - `created_at` timestamptz default now()
  - `updated_at` timestamptz default now()

2. Modified Tables
- `agents` — add `custom_message_privilege` boolean default false
  Controls whether an agent can type a custom message for Elizabeth to read.
  Only agents with this privilege get their text spoken on secretary calls.

3. Security
- Enable RLS on `secretary_calls`.
- Owner-scoped CRUD: each agent can only see/manage their own secretary calls.
- Policies use auth.uid() mapped through agents table (agent_id → agents.id → auth link).
- Since this app uses session-based auth (not Supabase auth), policies use TO anon, authenticated
  with ownership checked via agent_id match — the service role key is used server-side in edge functions,
  and the frontend goes through the wolf-provider edge function which verifies sessions.

4. Important Notes
- The secretary_calls table stores call metadata, not audio files — recordings are referenced by URL.
- DNC check is performed at call placement time (before dialing) by checking the calls table for is_dnc flags.
- Status updates happen via Bland.ai webhook callbacks to wolf-webhook.
*/ 

CREATE TABLE IF NOT EXISTS secretary_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  client_name text NOT NULL,
  client_phone text NOT NULL,
  mode text NOT NULL DEFAULT 'reminder' CHECK (mode IN ('reminder', 'transfer')),
  custom_message text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dialing', 'ringing', 'answered', 'transferred', 'voicemail_left', 'no_answer', 'failed', 'dnc_blocked', 'completed')),
  provider_call_id text,
  transfer_status text CHECK (transfer_status IS NULL OR transfer_status IN ('pending', 'bridged', 'failed')),
  transcript text,
  recording_url text,
  ai_summary text,
  error_message text,
  duration_seconds integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE secretary_calls ENABLE ROW LEVEL SECURITY;

-- The app uses session-based auth via edge functions with the service role key.
-- The frontend never touches this table directly — all access goes through
-- wolf-provider/wolf-secretary edge functions that verify the session.
-- Policies allow service-role access (which bypasses RLS) and deny direct anon access.
DROP POLICY IF EXISTS "deny_anon_select_secretary_calls" ON secretary_calls;
CREATE POLICY "deny_anon_select_secretary_calls" ON secretary_calls FOR SELECT TO anon, authenticated USING (false);

DROP POLICY IF EXISTS "deny_anon_insert_secretary_calls" ON secretary_calls;
CREATE POLICY "deny_anon_insert_secretary_calls" ON secretary_calls FOR INSERT TO anon, authenticated WITH CHECK (false);

DROP POLICY IF EXISTS "deny_anon_update_secretary_calls" ON secretary_calls;
CREATE POLICY "deny_anon_update_secretary_calls" ON secretary_calls FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "deny_anon_delete_secretary_calls" ON secretary_calls;
CREATE POLICY "deny_anon_delete_secretary_calls" ON secretary_calls FOR DELETE TO anon, authenticated USING (false);

-- Add custom_message_privilege column to agents
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agents' AND column_name = 'custom_message_privilege') THEN
    ALTER TABLE agents ADD COLUMN custom_message_privilege boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- Index for agent-scoped queries
CREATE INDEX IF NOT EXISTS idx_secretary_calls_agent_id ON secretary_calls(agent_id);
CREATE INDEX IF NOT EXISTS idx_secretary_calls_status ON secretary_calls(status);
CREATE INDEX IF NOT EXISTS idx_secretary_calls_created_at ON secretary_calls(created_at DESC);
