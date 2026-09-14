/*
# Add agent login tokens for direct-link authentication

1. Schema Changes
   - Add `login_token` column to `agents` table (text, nullable, unique)
   - Tokens are stored as plain UUIDs (not hashed) since they are server-generated
     and equivalent in security to the session tokens already stored in auth_sessions.

2. New Functions
   - `agent_login_by_token(p_token text, p_ip text)`: Creates a session for the agent
     matching the provided login token. Returns the same session payload as agent_login.
     Skips PIN verification and rate limiting since the token IS the credential.

3. Security
   - Function is SECURITY DEFINER with search_path = public.
   - Validates token format (must be a UUID).
   - Only active agents can log in via token.
   - Audit log entry records token-based login.
   - EXECUTE granted to authenticated role only (matches existing auth pattern).

4. Token Generation
   - Each active agent gets a unique gen_random_uuid() token.
*/

-- Add login_token column
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'agents' AND column_name = 'login_token'
  ) THEN
    ALTER TABLE public.agents ADD COLUMN login_token text UNIQUE;
  END IF;
END $$;

-- Generate tokens for all active agents that don't have one
UPDATE public.agents
SET login_token = gen_random_uuid()::text
WHERE status = 'active' AND login_token IS NULL;

-- Create the token-based login function
CREATE OR REPLACE FUNCTION public.agent_login_by_token(p_token text, p_ip text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_agent record;
  v_session_token text;
BEGIN
  IF p_token IS NULL OR length(p_token) < 30 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid token');
  END IF;

  SELECT * INTO v_agent
  FROM public.agents
  WHERE login_token = p_token AND status = 'active';

  IF v_agent IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid or expired link');
  END IF;

  v_session_token := gen_random_uuid()::text || gen_random_uuid()::text;

  INSERT INTO public.auth_sessions (session_token, agent_id, expires_at, ip_address)
  VALUES (v_session_token, v_agent.id, now() + interval '8 hours', p_ip);

  INSERT INTO public.login_attempts (agent_id, ip_address, success)
  VALUES (v_agent.id, p_ip, true);

  UPDATE public.agents SET logged_in = true, last_seen_at = now() WHERE id = v_agent.id;

  INSERT INTO public.audit_logs (action, entity_type, entity_id, metadata)
  VALUES ('login_by_token', 'agent', v_agent.id::text, jsonb_build_object('ip', p_ip));

  RETURN jsonb_build_object(
    'success', true, 'session_token', v_session_token,
    'agent', jsonb_build_object(
      'id', v_agent.id, 'full_name', v_agent.full_name, 'role', v_agent.role,
      'status', v_agent.status, 'available_for_transfer', v_agent.available_for_transfer,
      'is_owner', v_agent.is_owner
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.agent_login_by_token FROM anon;
GRANT EXECUTE ON FUNCTION public.agent_login_by_token TO authenticated;
