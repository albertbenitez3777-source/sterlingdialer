/*
# Drop stale search_contacts overload

The old 3-argument overload (p_search, p_limit, p_offset) conflicts with
the current 2-argument version. Drop it so calls resolve unambiguously.
*/
DROP FUNCTION IF EXISTS public.search_contacts(text, integer, integer);
