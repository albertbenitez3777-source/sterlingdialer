/*
# Add search_leads_by_phone function for agent client search bar
*/

CREATE OR REPLACE FUNCTION public.search_leads_by_phone(p_search text, p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Normalize the search input (strip non-digits)
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  FROM (
    SELECT id, name, telephone_original, telephone_normalized,
           address, income_range, home_value, property_information,
           notes, source, status, created_at,
           assigned_agent_id
    FROM public.leads
    WHERE
      -- Match by phone digits (normalized or original)
      regexp_replace(COALESCE(telephone_original, ''), '\D', '', 'g') LIKE '%' || regexp_replace(p_search, '\D', '', 'g') || '%'
      OR regexp_replace(COALESCE(telephone_normalized, ''), '\D', '', 'g') LIKE '%' || regexp_replace(p_search, '\D', '', 'g') || '%'
      -- Also match by name if search text contains letters
      OR (p_search ~ '[a-zA-Z]' AND name ILIKE '%' || p_search || '%')
    ORDER BY created_at DESC
    LIMIT p_limit
  ) t;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.search_leads_by_phone FROM anon;
GRANT EXECUTE ON FUNCTION public.search_leads_by_phone TO authenticated;
