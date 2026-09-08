/*
# Fix search_contacts — address search and OR clause precedence

## Problem
The previous rewrite had an OR clause without parentheses in the name_match_phones CTE,
causing address searches like "Miami FL" to match incorrectly and return non-Miami results.
The OR between the phone-digits condition and the name/address condition was being evaluated
before the AND with v_term, producing wrong matches.

## Fix
Add explicit parentheses around each OR branch so the WHERE clause evaluates correctly:
- Phone digit matches: (digits LIKE ...)
- Name/address matches: (name LIKE ... OR address LIKE ...)
Each branch is properly scoped with its own AND condition.

Non-destructive: function replacement only, no data changes.
*/

CREATE OR REPLACE FUNCTION public.search_contacts(p_search text DEFAULT '', p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_digits text;
  v_term text;
  v_results jsonb;
BEGIN
  v_term := LOWER(TRIM(COALESCE(p_search, '')));
  v_digits := regexp_replace(COALESCE(p_search, ''), '\D', '', 'g');

  IF v_term = '' AND v_digits = '' THEN
    RETURN jsonb_build_object('results', '[]'::jsonb, 'count', 0);
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.last_call_time DESC NULLS LAST, t.consumer_name), '[]'::jsonb)
  INTO v_results
  FROM (
    WITH matching_phones AS (
      SELECT l.telephone_normalized AS phone_norm
      FROM public.leads l
      WHERE v_digits <> ''
        AND (
          regexp_replace(COALESCE(l.telephone_original, ''), '\D', '', 'g') LIKE '%' || v_digits || '%'
          OR regexp_replace(COALESCE(l.telephone_normalized, ''), '\D', '', 'g') LIKE '%' || v_digits || '%'
        )

      UNION

      SELECT c.consumer_phone AS phone_norm
      FROM public.calls c
      WHERE v_digits <> ''
        AND regexp_replace(COALESCE(c.consumer_phone, ''), '\D', '', 'g') LIKE '%' || v_digits || '%'
    ),
    name_match_phones AS (
      SELECT l.telephone_normalized AS phone_norm
      FROM public.leads l
      WHERE v_term <> ''
        AND (
          LOWER(COALESCE(l.name, '')) LIKE '%' || v_term || '%'
          OR LOWER(COALESCE(l.address, '')) LIKE '%' || v_term || '%'
        )

      UNION

      SELECT c.consumer_phone AS phone_norm
      FROM public.calls c
      WHERE v_term <> ''
        AND LOWER(COALESCE(c.consumer_name, '')) LIKE '%' || v_term || '%'
    ),
    all_matching_phones AS (
      SELECT phone_norm FROM matching_phones
      WHERE phone_norm IS NOT NULL AND phone_norm <> ''
      UNION
      SELECT phone_norm FROM name_match_phones
      WHERE phone_norm IS NOT NULL AND phone_norm <> ''
    ),
    lead_data AS (
      SELECT DISTINCT ON (l.telephone_normalized)
        l.id AS lead_id,
        l.name AS lead_name,
        l.telephone_normalized,
        l.telephone_original,
        l.address AS lead_address,
        l.income_range AS lead_income,
        l.home_value AS lead_home_value,
        l.property_information AS lead_property,
        l.notes AS lead_notes,
        l.source AS lead_source,
        l.status AS lead_status,
        l.created_at AS lead_created_at
      FROM public.leads l
      WHERE l.telephone_normalized IN (SELECT phone_norm FROM all_matching_phones)
      ORDER BY l.telephone_normalized, l.created_at DESC
    ),
    call_data AS (
      SELECT DISTINCT ON (c.consumer_phone)
        c.id AS call_id,
        c.consumer_name AS call_name,
        c.consumer_phone,
        c.consumer_address AS call_address,
        c.consumer_income_range AS call_income,
        c.consumer_home_value AS call_home_value,
        c.consumer_property_info AS call_property,
        c.queue AS call_queue,
        c.disposition AS call_disposition,
        c.created_at AS call_created_at,
        c.ai_summary AS call_ai_summary,
        c.agent_id
      FROM public.calls c
      WHERE c.consumer_phone IN (SELECT phone_norm FROM all_matching_phones)
      ORDER BY c.consumer_phone, c.created_at DESC
    )
    SELECT
      COALESCE(ld.lead_id::text, cd.call_id::text) AS id,
      'merged'::text AS source,
      COALESCE(cd.call_name, ld.lead_name, 'Unknown') AS consumer_name,
      COALESCE(ld.telephone_original, ld.telephone_normalized, cd.consumer_phone) AS phone,
      COALESCE(ld.telephone_normalized, cd.consumer_phone) AS phone_normalized,
      COALESCE(NULLIF(cd.call_address, ''), NULLIF(ld.lead_address, ''), '') AS address,
      COALESCE(NULLIF(cd.call_income, ''), NULLIF(ld.lead_income, ''), '') AS income_range,
      COALESCE(NULLIF(cd.call_home_value, ''), NULLIF(ld.lead_home_value, ''), '') AS home_value,
      COALESCE(NULLIF(cd.call_property, ''), NULLIF(ld.lead_property, ''), '') AS property_information,
      ld.lead_notes AS notes,
      ld.lead_source AS lead_source,
      ld.lead_status AS lead_status,
      COALESCE(ld.lead_created_at, cd.call_created_at) AS created_at,
      cd.call_queue AS call_queue,
      cd.call_disposition AS call_disposition,
      cd.call_created_at AS last_call_time,
      ag.full_name AS agent_name,
      cd.call_ai_summary AS ai_summary
    FROM all_matching_phones amp
    LEFT JOIN lead_data ld ON ld.telephone_normalized = amp.phone_norm
    LEFT JOIN call_data cd ON cd.consumer_phone = amp.phone_norm
    LEFT JOIN public.agents ag ON cd.agent_id = ag.id
    WHERE ld.lead_id IS NOT NULL OR cd.call_id IS NOT NULL
    LIMIT p_limit
  ) t;

  RETURN jsonb_build_object('results', v_results, 'count', jsonb_array_length(v_results));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.search_contacts FROM anon;
GRANT EXECUTE ON FUNCTION public.search_contacts TO authenticated;
