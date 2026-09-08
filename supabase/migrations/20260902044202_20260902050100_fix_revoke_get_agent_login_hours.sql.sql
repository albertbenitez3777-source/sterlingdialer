/*
# Fix: Revoke EXECUTE on recreated get_agent_login_hours

The main hardening migration revoked EXECUTE on all SECURITY DEFINER functions,
but then recreated get_agent_login_hours with a fixed search_path, which
re-granted default EXECUTE to PUBLIC. This migration revokes it again.
*/

REVOKE EXECUTE ON FUNCTION public.get_agent_login_hours(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_agent_login_hours(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_agent_login_hours(text) FROM authenticated;
