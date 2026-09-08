/*
# Fix PIN salt generation

Replace gen_random_bytes (not available) with gen_random_uuid for salt generation.
No destructive operations. No data loss.
*/

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
  IF p_pin !~ '^\d{4}$' THEN
    RAISE EXCEPTION 'PIN must be exactly 4 digits';
  END IF;

  SELECT id INTO v_agent_id FROM public.agents WHERE full_name = p_agent_name;
  IF v_agent_id IS NULL THEN
    RAISE EXCEPTION 'Agent not found';
  END IF;

  v_salt := gen_random_uuid()::text || gen_random_uuid()::text;
  v_hash := public.hash_pin(p_pin, v_salt);

  UPDATE public.agents
  SET pin_digest = v_hash, pin_salt = v_salt
  WHERE id = v_agent_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_agent_pin FROM anon, authenticated;

-- Also fix agent_login session token generation
CREATE OR REPLACE FUNCTION public.agent_login(p_pin text, p_ip text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_agent record;
  v_session_token text;
  v_recent_fail_count integer;
BEGIN
  IF p_pin IS NULL OR p_pin !~ '^\d{4}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid PIN format');
  END IF;

  FOR v_agent IN SELECT * FROM public.agents LOOP
    BEGIN
      IF public.verify_pin(v_agent.id, p_pin) THEN
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

        IF v_agent.status = 'disabled' THEN
          INSERT INTO public.login_attempts (agent_id, ip_address, success) VALUES (v_agent.id, p_ip, false);
          INSERT INTO public.audit_logs (action, entity_type, entity_id, metadata)
          VALUES ('login_disabled', 'agent', v_agent.id::text, jsonb_build_object('reason', 'account_disabled'));
          RETURN jsonb_build_object('success', false, 'error', 'This account is inactive. Contact your administrator.');
        END IF;

        v_session_token := gen_random_uuid()::text || gen_random_uuid()::text;

        INSERT INTO public.auth_sessions (session_token, agent_id, expires_at, ip_address)
        VALUES (v_session_token, v_agent.id, now() + interval '8 hours', p_ip);

        INSERT INTO public.login_attempts (agent_id, ip_address, success) VALUES (v_agent.id, p_ip, true);

        UPDATE public.agents SET logged_in = true, last_seen_at = now() WHERE id = v_agent.id;

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

  INSERT INTO public.login_attempts (agent_id, ip_address, success) VALUES (NULL, p_ip, false);
  INSERT INTO public.audit_logs (action, entity_type, entity_id, metadata)
  VALUES ('login_failed', 'auth', '', jsonb_build_object('ip', p_ip, 'reason', 'no_match'));

  RETURN jsonb_build_object('success', false, 'error', 'Invalid PIN. Please try again.');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.agent_login FROM anon;
GRANT EXECUTE ON FUNCTION public.agent_login TO authenticated;
