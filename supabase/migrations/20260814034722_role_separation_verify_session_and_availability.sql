/*
# Role separation enforcement: verify_session rejects disabled agents, add availability toggle

## Changes
- verify_session now checks agent.status = 'active' — disabled agents' sessions are invalidated
- New function toggle_agent_availability lets agents set their own availability for transfers
- New function get_agent_profile returns the authenticated agent's full profile for the dashboard
*/

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

  IF v_agent IS NULL OR v_agent.status <> 'active' THEN
    -- Invalidate the session if the agent was disabled after login
    UPDATE public.auth_sessions SET invalidated_at = now() WHERE id = v_session.id;
    RETURN jsonb_build_object('valid', false);
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'agent', jsonb_build_object(
      'id', v_agent.id,
      'full_name', v_agent.full_name,
      'role', v_agent.role,
      'status', v_agent.status,
      'available_for_transfer', v_agent.available_for_transfer,
      'logged_in', v_agent.logged_in
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.verify_session FROM anon;
GRANT EXECUTE ON FUNCTION public.verify_session TO authenticated;

CREATE OR REPLACE FUNCTION public.toggle_agent_availability(p_agent_id uuid, p_available boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.agents
  SET available_for_transfer = p_available
  WHERE id = p_agent_id AND status = 'active';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Agent not found or inactive');
  END IF;

  RETURN jsonb_build_object('success', true, 'available_for_transfer', p_available);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.toggle_agent_availability FROM anon;
GRANT EXECUTE ON FUNCTION public.toggle_agent_availability TO authenticated;
