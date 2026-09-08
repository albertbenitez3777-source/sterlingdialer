/*
# Fix owner_setup_pin to pass agent name instead of ID

The set_agent_pin function accepts (p_agent_name text, p_pin text),
but owner_setup_pin was calling it with (v_owner.id, p_pin) which caused a type error.
*/

CREATE OR REPLACE FUNCTION public.owner_setup_pin(p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_owner record;
BEGIN
  IF p_pin IS NULL OR p_pin !~ '^\d{4}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'PIN must be exactly four digits');
  END IF;
  SELECT * INTO v_owner FROM public.agents WHERE is_owner = true LIMIT 1;
  IF v_owner IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Owner account not found'); END IF;
  IF v_owner.pin_digest <> '' THEN RETURN jsonb_build_object('success', false, 'error', 'Owner PIN already set'); END IF;
  PERFORM public.set_agent_pin(v_owner.full_name, p_pin);
  INSERT INTO public.audit_logs (action, entity_type, entity_id, metadata)
  VALUES ('owner_pin_set', 'agent', v_owner.id::text, jsonb_build_object('method', 'first_time_setup'));
  RETURN jsonb_build_object('success', true);
END;
$$;
