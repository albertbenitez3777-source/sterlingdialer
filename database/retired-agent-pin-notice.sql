-- Additive login-only change. Existing sessions and agent_login are unchanged.
CREATE SCHEMA IF NOT EXISTS federal_one_login_private;
REVOKE ALL ON SCHEMA federal_one_login_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA federal_one_login_private TO service_role;

CREATE TABLE federal_one_login_private.retired_pins (
  agent_id uuid PRIMARY KEY REFERENCES public.agents(id),
  pin_digest text NOT NULL CHECK (pin_digest <> ''),
  pin_salt text NOT NULL CHECK (pin_salt <> ''),
  retired_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE federal_one_login_private.retired_pins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON federal_one_login_private.retired_pins FROM PUBLIC, anon, authenticated;
GRANT SELECT ON federal_one_login_private.retired_pins TO service_role;

CREATE FUNCTION public.agent_login_with_retired_pin_notice(p_pin text, p_ip text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF p_pin IS NOT NULL AND p_pin ~ '^[0-9]{4}$' AND EXISTS (
    SELECT 1 FROM federal_one_login_private.retired_pins r
    WHERE public.hash_pin(p_pin, r.pin_salt) = r.pin_digest
  ) THEN
    RETURN jsonb_build_object('success', false, 'code', 'RETIRED_PIN_OFFLINE',
      'error', 'System is offline permanently');
  END IF;
  RETURN public.agent_login(p_pin, p_ip);
END;
$function$;
REVOKE ALL ON FUNCTION public.agent_login_with_retired_pin_notice(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_login_with_retired_pin_notice(text,text) TO service_role;
