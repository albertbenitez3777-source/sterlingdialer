/*
# Universal contact search — searches both leads AND calls tables
# so contacts from before any reset are still findable.
# Searches by name (partial) or phone (digits match).
*/
CREATE OR REPLACE FUNCTION public.search_contacts(
  p_search text DEFAULT '',
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_digits text;
  v_term text;
  v_leads jsonb;
  v_calls jsonb;
  v_merged jsonb;
BEGIN
  v_term := LOWER(TRIM(COALESCE(p_search, '')));
  v_digits := regexp_replace(COALESCE(p_search, ''), '\D', '', 'g');
  
  IF v_term = '' AND v_digits = '' THEN
    RETURN jsonb_build_object('results', '[]'::jsonb, 'count', 0);
  END IF;

  -- Search leads table (all leads, regardless of status)
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO v_leads
  FROM (
    SELECT
      'lead'::text as source,
      l.id,
      l.name as consumer_name,
      COALESCE(l.telephone_original, l.telephone_normalized) as phone,
      l.telephone_normalized as phone_normalized,
      l.address,
      l.income_range,
      l.home_value,
      l.property_information,
      l.notes,
      l.source as lead_source,
      l.status as lead_status,
      l.created_at,
      NULL::text as call_queue,
      NULL::text as call_disposition,
      NULL::timestamptz as last_call_time,
      NULL::text as agent_name,
      NULL::text as ai_summary
    FROM public.leads l
    WHERE
      (v_digits <> '' AND (
        regexp_replace(COALESCE(l.telephone_original, ''), '\D', '', 'g') LIKE '%' || v_digits || '%'
        OR regexp_replace(COALESCE(l.telephone_normalized, ''), '\D', '', 'g') LIKE '%' || v_digits || '%'
      ))
      OR (
        v_term <> '' AND (
          LOWER(COALESCE(l.name, '')) LIKE '%' || v_term || '%'
          OR LOWER(COALESCE(l.address, '')) LIKE '%' || v_term || '%'
        )
      )
    ORDER BY l.created_at DESC
    LIMIT p_limit
  ) t;

  -- Search calls table (all calls — covers contacts from before any reset)
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO v_calls
  FROM (
    SELECT DISTINCT ON (c.consumer_phone)
      'call'::text as source,
      c.id,
      c.consumer_name,
      c.consumer_phone as phone,
      c.consumer_phone as phone_normalized,
      c.consumer_address as address,
      c.consumer_income_range as income_range,
      c.consumer_home_value as home_value,
      c.consumer_property_info as property_information,
      NULL::text as notes,
      NULL::text as lead_source,
      NULL::text as lead_status,
      c.created_at,
      c.queue as call_queue,
      c.disposition as call_disposition,
      c.created_at as last_call_time,
      a.full_name as agent_name,
      c.ai_summary
    FROM public.calls c
    LEFT JOIN public.agents a ON c.agent_id = a.id
    WHERE
      COALESCE(c.consumer_phone, '') <> ''
      AND (
        (v_digits <> '' AND regexp_replace(COALESCE(c.consumer_phone, ''), '\D', '', 'g') LIKE '%' || v_digits || '%')
        OR (v_term <> '' AND LOWER(COALESCE(c.consumer_name, '')) LIKE '%' || v_term || '%')
      )
    ORDER BY c.consumer_phone, c.created_at DESC
    LIMIT p_limit
  ) t;

  -- Merge and deduplicate by phone number (prefer call records as they have more recent info)
  WITH all_results AS (
    SELECT * FROM jsonb_array_elements(v_leads) AS le(elem)
    UNION ALL
    SELECT * FROM jsonb_array_elements(v_calls) AS ce(elem)
  ),
  deduped AS (
    SELECT elem
    FROM all_results
    ORDER BY
      CASE WHEN elem->>'source' = 'call' THEN 0 ELSE 1 END,
      (elem->>'created_at') DESC
  )
  SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
  INTO v_merged
  FROM (
    SELECT DISTINCT ON (COALESCE(elem->>'phone_normalized', elem->>'phone'))
      elem
    FROM deduped
    ORDER BY COALESCE(elem->>'phone_normalized', elem->>'phone'), (elem->>'created_at') DESC
    LIMIT p_limit
  ) t;

  RETURN jsonb_build_object('results', v_merged, 'count', jsonb_array_length(v_merged));
END;
$$;

REVOKE ALL ON FUNCTION public.search_contacts(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_contacts(text, integer) TO authenticated, anon;
