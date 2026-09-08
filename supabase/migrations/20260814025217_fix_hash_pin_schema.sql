/*
# Fix hash_pin to use extensions schema for pgcrypto digest

pgcrypto is installed in the `extensions` schema, so digest() must be called as extensions.digest().
No destructive operations.
*/

CREATE OR REPLACE FUNCTION public.hash_pin(p_pin text, p_salt text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_hash text;
BEGIN
  v_hash := encode(extensions.digest(p_pin || p_salt, 'sha256'), 'hex');
  RETURN v_hash;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.hash_pin FROM anon, authenticated;
