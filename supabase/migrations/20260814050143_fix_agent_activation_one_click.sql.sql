/*
# Make agent activation set all runtime flags in one click

When an admin selects an agent for the dialer, also set logged_in and
available_for_transfer to true so the agent is immediately ready for
campaign start without requiring a separate login and availability toggle.
*/

CREATE OR REPLACE FUNCTION public.set_agent_dialer_selection(p_agent_id uuid, p_selected boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_selected THEN
    UPDATE public.agents
    SET active_for_dialer = true,
        logged_in = true,
        available_for_transfer = true,
        last_seen_at = now()
    WHERE id = p_agent_id AND is_owner = false;
  ELSE
    UPDATE public.agents
    SET active_for_dialer = false,
        available_for_transfer = false
    WHERE id = p_agent_id AND is_owner = false;
  END IF;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Agent not found or is owner'); END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_agent_dialer_selection FROM anon;
GRANT EXECUTE ON FUNCTION public.set_agent_dialer_selection TO authenticated;
