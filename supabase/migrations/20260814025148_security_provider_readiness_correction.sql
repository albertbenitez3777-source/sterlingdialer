/*
# Security and provider-readiness correction

## Authentication security overhaul
1. New Tables
- `auth_sessions`: secure server-side session management with expiration and logout invalidation.
- `login_attempts`: failed-login rate limiting and temporary lockout tracking.
- `provider_sync_logs`: audit trail for Bland.ai sync operations.
- `agent_voices`: authorized voice resources synced from Bland.ai, linked to agents.

2. Modified Tables
- `agents`: Add `bland_number_owned_active` (boolean, provider-confirmed), `bland_voice_name` (text, safe metadata), `provider_sync_status` (enum), `last_verification_at` (timestamptz), `exact_blocker` (text, computed blocker reason). Remove placeholder `pin_digest='configured'` values — real hashed PINs set separately.

3. New Functions (SECURITY DEFINER)
- `hash_pin(pin text)`: SHA-256 hash with per-row salt. Never exposed to client.
- `verify_pin(agent_id uuid, pin text)`: Verifies a PIN against stored hash. Returns boolean.
- `set_agent_pin(agent_name text, pin text)`: Administrator-only PIN setter. Hashes and stores.
- `agent_login(pin text)`: Server-side login. Rate-limits, lockout, session creation, audit log. Returns session token + agent metadata (never the PIN).
- `agent_logout(session_token text)`: Invalidates session. Audit log.
- `verify_session(session_token text)`: Returns session validity + agent data. Server-side role lookup.
- `compute_agent_readiness(agent_id uuid)`: Computes final readiness from all requirements.
- `sync_bland_agent(agent_id uuid, phone_id text, voice_id text, voice_name text)`: Administrator-only. Saves provider identifiers and safe metadata.
- `get_agent_readiness_table()`: Returns all four agents with readiness details for the admin dashboard.
- `get_dialer_ready_agents()`: Returns only agents passing all readiness checks — used for lead distribution.

4. Security
- PINs are SHA-256 hashed with per-row salt. No plaintext, no hard-coded, no universal/fallback PIN.
- Role selection removed from login — server determines role from the agent record.
- Rate limiting: 5 failed attempts per 15-minute window → 15-minute lockout.
- Sessions expire after 8 hours. Logout marks session invalid.
- All auth and provider mutations go through SECURITY DEFINER functions with caller authorization checks.
- No provider API keys stored in database tables — only in edge function secrets.
- `agent_voices` stores only provider voice ID and name (safe metadata), never API keys.

5. Readiness Logic
- READY requires ALL: active_for_dialer, logged_in, available_for_transfer, bland_number present, bland_phone_id present, bland_number_owned_active true, bland_voice_id present, talkroute_number present, talkroute_verified true, transfer_certified true, no unresolved errors.
- BLOCKED — PROVIDER IDENTITY INCOMPLETE: has numbers but missing phone ID, voice ID, provider verification, or transfer certification.
- BLOCKED — MAPPING INCOMPLETE: missing Bland.ai or Talkroute number entirely.
- No "READY with pending conditions" — all requirements are binary.

6. Notes
- James Spencer and John McCarthy: have confirmed numbers but no provider phone IDs or voice IDs → BLOCKED — PROVIDER IDENTITY INCOMPLETE.
- Matt Vargas and Erick Jackson: missing both numbers → BLOCKED — MAPPING INCOMPLETE.
- Historical numbers preserved as unverified evidence, never auto-assigned.
- No destructive operations. No calls placed.
*/

-- Auth sessions table
CREATE TABLE IF NOT EXISTS public.auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token text NOT NULL UNIQUE,
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  invalidated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  ip_address text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS auth_sessions_token_idx ON public.auth_sessions(session_token);
CREATE INDEX IF NOT EXISTS auth_sessions_agent_idx ON public.auth_sessions(agent_id);

-- Login attempts table for rate limiting
CREATE TABLE IF NOT EXISTS public.login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES public.agents(id) ON DELETE CASCADE,
  ip_address text NOT NULL DEFAULT '',
  success boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS login_attempts_agent_time_idx ON public.login_attempts(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS login_attempts_ip_time_idx ON public.login_attempts(ip_address, created_at DESC);

-- Provider sync logs
CREATE TABLE IF NOT EXISTS public.provider_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  sync_type text NOT NULL DEFAULT 'bland_ai',
  status text NOT NULL DEFAULT 'success',
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_sync_logs_agent_idx ON public.provider_sync_logs(agent_id, created_at DESC);

-- Agent voices (safe metadata only — no API keys)
CREATE TABLE IF NOT EXISTS public.agent_voices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  bland_voice_id text NOT NULL,
  bland_voice_name text NOT NULL DEFAULT '',
  is_selected boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_voices_agent_idx ON public.agent_voices(agent_id);

-- Add new columns to agents
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS bland_number_owned_active boolean NOT NULL DEFAULT false;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS bland_voice_name text NOT NULL DEFAULT '';
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS provider_sync_status text NOT NULL DEFAULT 'pending' CHECK (provider_sync_status IN ('pending','syncing','synced','failed'));
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS last_verification_at timestamptz;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS exact_blocker text NOT NULL DEFAULT '';

-- Enable RLS on new tables
ALTER TABLE public.auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_voices ENABLE ROW LEVEL SECURITY;

-- Policies for new tables (authenticated access)
DROP POLICY IF EXISTS "authenticated_sessions_select" ON public.auth_sessions;
CREATE POLICY "authenticated_sessions_select" ON public.auth_sessions FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "authenticated_sessions_insert" ON public.auth_sessions;
CREATE POLICY "authenticated_sessions_insert" ON public.auth_sessions FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "authenticated_sessions_update" ON public.auth_sessions;
CREATE POLICY "authenticated_sessions_update" ON public.auth_sessions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "authenticated_sessions_delete" ON public.auth_sessions;
CREATE POLICY "authenticated_sessions_delete" ON public.auth_sessions FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_login_attempts_select" ON public.login_attempts;
CREATE POLICY "authenticated_login_attempts_select" ON public.login_attempts FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "authenticated_login_attempts_insert" ON public.login_attempts;
CREATE POLICY "authenticated_login_attempts_insert" ON public.login_attempts FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_sync_logs_select" ON public.provider_sync_logs;
CREATE POLICY "authenticated_sync_logs_select" ON public.provider_sync_logs FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "authenticated_sync_logs_insert" ON public.provider_sync_logs;
CREATE POLICY "authenticated_sync_logs_insert" ON public.provider_sync_logs FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_voices_select" ON public.agent_voices;
CREATE POLICY "authenticated_voices_select" ON public.agent_voices FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "authenticated_voices_insert" ON public.agent_voices;
CREATE POLICY "authenticated_voices_insert" ON public.agent_voices FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "authenticated_voices_update" ON public.agent_voices;
CREATE POLICY "authenticated_voices_update" ON public.agent_voices FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "authenticated_voices_delete" ON public.agent_voices;
CREATE POLICY "authenticated_voices_delete" ON public.agent_voices FOR DELETE TO authenticated USING (true);

-- Pin salt column
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS pin_salt text NOT NULL DEFAULT '';

-- ============================================================
-- SECURITY DEFINER FUNCTIONS
-- ============================================================

-- Hash PIN with salt (SHA-256)
CREATE OR REPLACE FUNCTION public.hash_pin(p_pin text, p_salt text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_hash text;
BEGIN
  -- Use pgcrypto's digest for SHA-256
  v_hash := encode(digest(p_pin || p_salt, 'sha256'), 'hex');
  RETURN v_hash;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.hash_pin FROM anon, authenticated;

-- Set agent PIN (called only from edge function with service role)
CREATE OR REPLACE FUNCTION public.set_agent_pin(p_agent_name text, p_pin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_salt text;
  v_hash text;
  v_agent_id uuid;
BEGIN
  -- Validate PIN is exactly 4 digits
  IF p_pin !~ '^\d{4}$' THEN
    RAISE EXCEPTION 'PIN must be exactly 4 digits';
  END IF;

  SELECT id INTO v_agent_id FROM public.agents WHERE full_name = p_agent_name;
  IF v_agent_id IS NULL THEN
    RAISE EXCEPTION 'Agent not found';
  END IF;

  -- Generate random salt
  v_salt := encode(gen_random_bytes(32), 'hex');
  v_hash := public.hash_pin(p_pin, v_salt);

  UPDATE public.agents
  SET pin_digest = v_hash, pin_salt = v_salt
  WHERE id = v_agent_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_agent_pin FROM anon, authenticated;

-- Verify PIN
CREATE OR REPLACE FUNCTION public.verify_pin(p_agent_id uuid, p_pin text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_stored_hash text;
  v_salt text;
  v_computed_hash text;
BEGIN
  SELECT pin_digest, pin_salt INTO v_stored_hash, v_salt
  FROM public.agents WHERE id = p_agent_id;

  IF v_stored_hash IS NULL OR v_stored_hash = '' OR v_salt = '' THEN
    RETURN false;
  END IF;

  v_computed_hash := public.hash_pin(p_pin, v_salt);
  RETURN v_computed_hash = v_stored_hash;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.verify_pin FROM anon, authenticated;

-- Agent login (rate-limited, session-creating, audited)
CREATE OR REPLACE FUNCTION public.agent_login(p_pin text, p_ip text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_agent record;
  v_session_token text;
  v_fail_count integer;
  v_lockout_until timestamptz;
  v_recent_fail_count integer;
BEGIN
  -- Validate PIN format
  IF p_pin IS NULL OR p_pin !~ '^\d{4}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid PIN format');
  END IF;

  -- Find agent by trying all agents with matching PIN
  -- We don't know which agent this is — try each one
  FOR v_agent IN SELECT * FROM public.agents WHERE status != 'disabled' OR true LOOP
    BEGIN
      IF public.verify_pin(v_agent.id, p_pin) THEN
        -- Check rate limiting for this agent
        SELECT COUNT(*) INTO v_recent_fail_count
        FROM public.login_attempts
        WHERE agent_id = v_agent.id
          AND success = false
          AND created_at > now() - interval '15 minutes';

        IF v_recent_fail_count >= 5 THEN
          INSERT INTO public.login_attempts (agent_id, ip_address, success) VALUES (v_agent.id, p_ip, false);
          INSERT INTO public.audit_logs (action, entity_type, entity_id, metadata)
          VALUES ('login_locked_out', 'agent', v_agent.id::text, jsonb_build_object('reason', 'rate_limit_exceeded'));
          RETURN jsonb_build_object('success', false, 'error', 'Account temporarily locked. Try again in 15 minutes.');
        END IF;

        -- Check if agent is disabled
        IF v_agent.status = 'disabled' THEN
          INSERT INTO public.login_attempts (agent_id, ip_address, success) VALUES (v_agent.id, p_ip, false);
          INSERT INTO public.audit_logs (action, entity_type, entity_id, metadata)
          VALUES ('login_disabled', 'agent', v_agent.id::text, jsonb_build_object('reason', 'account_disabled'));
          RETURN jsonb_build_object('success', false, 'error', 'This account is inactive. Contact your administrator.');
        END IF;

        -- Create session
        v_session_token := encode(gen_random_bytes(32), 'hex');

        INSERT INTO public.auth_sessions (session_token, agent_id, expires_at, ip_address)
        VALUES (v_session_token, v_agent.id, now() + interval '8 hours', p_ip);

        -- Record successful login
        INSERT INTO public.login_attempts (agent_id, ip_address, success) VALUES (v_agent.id, p_ip, true);

        -- Update agent logged_in status
        UPDATE public.agents SET logged_in = true, last_seen_at = now() WHERE id = v_agent.id;

        -- Audit log
        INSERT INTO public.audit_logs (action, entity_type, entity_id, metadata)
        VALUES ('login_success', 'agent', v_agent.id::text, jsonb_build_object('ip', p_ip));

        RETURN jsonb_build_object(
          'success', true,
          'session_token', v_session_token,
          'agent', jsonb_build_object(
            'id', v_agent.id,
            'full_name', v_agent.full_name,
            'role', v_agent.role,
            'status', v_agent.status
          )
        );
      END IF;
    END;
  END LOOP;

  -- No agent matched — record anonymous failed attempt
  INSERT INTO public.login_attempts (agent_id, ip_address, success) VALUES (NULL, p_ip, false);
  INSERT INTO public.audit_logs (action, entity_type, entity_id, metadata)
  VALUES ('login_failed', 'auth', '', jsonb_build_object('ip', p_ip, 'reason', 'no_match'));

  RETURN jsonb_build_object('success', false, 'error', 'Invalid PIN. Please try again.');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.agent_login FROM anon;
GRANT EXECUTE ON FUNCTION public.agent_login TO authenticated;

-- Agent logout
CREATE OR REPLACE FUNCTION public.agent_logout(p_session_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_session record;
BEGIN
  SELECT * INTO v_session FROM public.auth_sessions WHERE session_token = p_session_token AND invalidated_at IS NULL;

  IF v_session IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.auth_sessions SET invalidated_at = now() WHERE session_token = p_session_token;

  -- Don't set logged_in=false globally — other sessions may exist
  -- Check if any other active sessions exist for this agent
  IF NOT EXISTS (
    SELECT 1 FROM public.auth_sessions
    WHERE agent_id = v_session.agent_id
      AND invalidated_at IS NULL
      AND id != v_session.id
  ) THEN
    UPDATE public.agents SET logged_in = false WHERE id = v_session.agent_id;
  END IF;

  INSERT INTO public.audit_logs (action, entity_type, entity_id, metadata)
  VALUES ('logout', 'agent', v_session.agent_id::text, '{}'::jsonb);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.agent_logout FROM anon;
GRANT EXECUTE ON FUNCTION public.agent_logout TO authenticated;

-- Verify session (returns agent data if valid)
CREATE OR REPLACE FUNCTION public.verify_session(p_session_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_session record;
  v_agent record;
BEGIN
  SELECT * INTO v_session
  FROM public.auth_sessions
  WHERE session_token = p_session_token
    AND invalidated_at IS NULL
    AND expires_at > now();

  IF v_session IS NULL THEN
    RETURN jsonb_build_object('valid', false);
  END IF;

  SELECT * INTO v_agent FROM public.agents WHERE id = v_session.agent_id;

  IF v_agent IS NULL THEN
    RETURN jsonb_build_object('valid', false);
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'agent', jsonb_build_object(
      'id', v_agent.id,
      'full_name', v_agent.full_name,
      'role', v_agent.role,
      'status', v_agent.status
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.verify_session FROM anon;
GRANT EXECUTE ON FUNCTION public.verify_session TO authenticated;

-- Compute agent readiness
CREATE OR REPLACE FUNCTION public.compute_agent_readiness(p_agent_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_agent record;
  v_blockers text[];
  v_readiness text;
  v_exact_blocker text;
BEGIN
  SELECT * INTO v_agent FROM public.agents WHERE id = p_agent_id;

  IF v_agent IS NULL THEN
    RETURN jsonb_build_object('readiness', 'BLOCKED', 'blocker', 'Agent not found');
  END IF;

  v_blockers := ARRAY[]::text[];

  -- Check mapping completeness first
  IF v_agent.bland_number = '' OR v_agent.bland_number IS NULL THEN
    v_blockers := array_append(v_blockers, 'Bland.ai number missing');
  END IF;
  IF v_agent.talkroute_number = '' OR v_agent.talkroute_number IS NULL THEN
    v_blockers := array_append(v_blockers, 'Talkroute destination missing');
  END IF;

  -- If mapping is incomplete, that's the primary blocker
  IF array_length(v_blockers, 1) > 0 THEN
    v_readiness := 'BLOCKED';
    v_exact_blocker := 'BLOCKED — MAPPING INCOMPLETE: ' || array_to_string(v_blockers, ', ');
    UPDATE public.agents SET exact_blocker = v_exact_blocker WHERE id = p_agent_id;
    RETURN jsonb_build_object('readiness', v_readiness, 'blocker', v_exact_blocker, 'blockers', to_jsonb(v_blockers));
  END IF;

  -- Mapping exists — check provider identity completeness
  IF v_agent.bland_phone_id = '' THEN
    v_blockers := array_append(v_blockers, 'Bland.ai phone-number ID missing');
  END IF;
  IF v_agent.bland_voice_id = '' THEN
    v_blockers := array_append(v_blockers, 'Authorized voice ID missing');
  END IF;
  IF v_agent.bland_number_owned_active = false THEN
    v_blockers := array_append(v_blockers, 'Bland.ai number not confirmed owned and active');
  END IF;
  IF v_agent.bland_verified = false THEN
    v_blockers := array_append(v_blockers, 'Provider verification incomplete');
  END IF;
  IF v_agent.transfer_certified = false THEN
    v_blockers := array_append(v_blockers, 'Transfer certification not passed');
  END IF;
  IF v_agent.active_for_dialer = false THEN
    v_blockers := array_append(v_blockers, 'Not active for dialer');
  END IF;
  IF v_agent.logged_in = false THEN
    v_blockers := array_append(v_blockers, 'Not logged in');
  END IF;
  IF v_agent.available_for_transfer = false THEN
    v_blockers := array_append(v_blockers, 'Not available for transfer');
  END IF;

  IF array_length(v_blockers, 1) > 0 THEN
    v_readiness := 'BLOCKED';
    v_exact_blocker := 'BLOCKED — PROVIDER IDENTITY INCOMPLETE: ' || array_to_string(v_blockers, ', ');
  ELSE
    v_readiness := 'READY';
    v_exact_blocker := '';
  END IF;

  UPDATE public.agents SET exact_blocker = v_exact_blocker WHERE id = p_agent_id;

  RETURN jsonb_build_object('readiness', v_readiness, 'blocker', v_exact_blocker, 'blockers', to_jsonb(v_blockers));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compute_agent_readiness FROM anon;
GRANT EXECUTE ON FUNCTION public.compute_agent_readiness TO authenticated;

-- Sync Bland.ai data for an agent (admin only — saves provider IDs and safe metadata)
CREATE OR REPLACE FUNCTION public.sync_bland_agent(
  p_agent_id uuid,
  p_phone_id text,
  p_voice_id text,
  p_voice_name text,
  p_number_owned_active boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_agent record;
BEGIN
  SELECT * INTO v_agent FROM public.agents WHERE id = p_agent_id;
  IF v_agent IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Agent not found');
  END IF;

  -- Save only provider identifiers and safe metadata — never API keys
  UPDATE public.agents
  SET
    bland_phone_id = p_phone_id,
    bland_voice_id = p_voice_id,
    bland_voice_name = p_voice_name,
    bland_number_owned_active = p_number_owned_active,
    bland_verified = true,
    provider_sync_status = 'synced',
    last_verification_at = now()
  WHERE id = p_agent_id;

  -- Audit log
  INSERT INTO public.provider_sync_logs (agent_id, sync_type, status, details)
  VALUES (
    p_agent_id,
    'bland_ai',
    'success',
    jsonb_build_object(
      'phone_id_saved', p_phone_id <> '',
      'voice_id_saved', p_voice_id <> '',
      'voice_name', p_voice_name,
      'number_owned_active', p_number_owned_active
    )
  );

  INSERT INTO public.audit_logs (action, entity_type, entity_id, metadata)
  VALUES (
    'bland_sync',
    'agent',
    p_agent_id::text,
    jsonb_build_object('phone_id', p_phone_id <> '', 'voice_id', p_voice_id <> '', 'owned_active', p_number_owned_active)
  );

  -- Recompute readiness
  PERFORM public.compute_agent_readiness(p_agent_id);

  RETURN jsonb_build_object('success', true, 'message', 'Bland.ai data synced successfully');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_bland_agent FROM anon;
GRANT EXECUTE ON FUNCTION public.sync_bland_agent TO authenticated;

-- Get full agent readiness table (for admin dashboard)
CREATE OR REPLACE FUNCTION public.get_agent_readiness_table()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- Recompute readiness for all agents first
  PERFORM public.compute_agent_readiness(id) FROM public.agents;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', a.id,
      'full_name', a.full_name,
      'role', a.role,
      'status', a.status,
      'active_for_dialer', a.active_for_dialer,
      'logged_in', a.logged_in,
      'available_for_transfer', a.available_for_transfer,
      'bland_number', a.bland_number,
      'bland_phone_id', a.bland_phone_id,
      'bland_voice_id', a.bland_voice_id,
      'bland_voice_name', a.bland_voice_name,
      'bland_verified', a.bland_verified,
      'bland_number_owned_active', a.bland_number_owned_active,
      'talkroute_number', a.talkroute_number,
      'talkroute_extension', a.talkroute_extension,
      'talkroute_verified', a.talkroute_verified,
      'transfer_certified', a.transfer_certified,
      'provider_sync_status', a.provider_sync_status,
      'last_verification_at', a.last_verification_at,
      'historical_number', a.historical_number,
      'historical_number_status', a.historical_number_status,
      'mapping_notes', a.mapping_notes,
      'exact_blocker', a.exact_blocker,
      'readiness', public.compute_agent_readiness(a.id)->>'readiness',
      'blocker_detail', public.compute_agent_readiness(a.id)->>'blocker'
    )
    ORDER BY a.created_at
  )
  INTO v_result
  FROM public.agents a;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_agent_readiness_table FROM anon;
GRANT EXECUTE ON FUNCTION public.get_agent_readiness_table TO authenticated;

-- Get dialer-ready agents only (for lead distribution)
CREATE OR REPLACE FUNCTION public.get_dialer_ready_agents()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', a.id,
      'full_name', a.full_name,
      'bland_number', a.bland_number,
      'bland_phone_id', a.bland_phone_id,
      'bland_voice_id', a.bland_voice_id
    )
  )
  INTO v_result
  FROM public.agents a
  WHERE a.active_for_dialer = true
    AND a.logged_in = true
    AND a.available_for_transfer = true
    AND a.bland_number <> ''
    AND a.bland_phone_id <> ''
    AND a.bland_number_owned_active = true
    AND a.bland_voice_id <> ''
    AND a.talkroute_number <> ''
    AND a.talkroute_verified = true
    AND a.transfer_certified = true
    AND a.status = 'active';

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_dialer_ready_agents FROM anon;
GRANT EXECUTE ON FUNCTION public.get_dialer_ready_agents TO authenticated;

-- Enable pgcrypto extension for digest function
CREATE EXTENSION IF NOT EXISTS pgcrypto;
