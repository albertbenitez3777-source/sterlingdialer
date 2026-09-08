/*
# Fix: Set search_path on no-arg get_agent_login_hours overload

A second overload of get_agent_login_hours with no arguments was missing
the search_path=public setting. This sets it.
*/

ALTER FUNCTION public.get_agent_login_hours() SET search_path = public;
