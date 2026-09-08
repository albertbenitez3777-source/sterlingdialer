-- Fix search_leads_by_phone: use RETURN QUERY instead of SELECT inside PL/pgSQL
CREATE OR REPLACE FUNCTION public.search_leads_by_phone(
  p_search text DEFAULT '',
  p_limit integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_digits text;
  v_result jsonb;
BEGIN
  v_digits := regexp_replace(COALESCE(p_search, ''), '\D', '', 'g');
  IF v_digits = '' THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      id, name, telephone_original, telephone_normalized,
      address, income_range, home_value, property_information,
      notes, source, status, created_at,
      assigned_agent_id
    FROM public.leads
    WHERE
      regexp_replace(COALESCE(telephone_original, ''), '\D', '', 'g') LIKE '%' || v_digits || '%'
      OR regexp_replace(COALESCE(telephone_normalized, ''), '\D', '', 'g') LIKE '%' || v_digits || '%'
    ORDER BY created_at DESC
    LIMIT p_limit
  ) t;

  RETURN v_result;
END;
$$;
