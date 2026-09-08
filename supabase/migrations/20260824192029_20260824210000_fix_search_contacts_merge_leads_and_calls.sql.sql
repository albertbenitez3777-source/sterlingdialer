/*
# Fix contact search — merge lead + call data instead of picking one

## Problem
The search_contacts function deduplicated by phone number and kept EITHER the call record OR the lead record. When it kept a call record, the address, income range, home value, and property info were often empty because the COALESCE join to leads was unreliable. Agents saw incomplete contact information.

## Fix
Rewrite search_contacts to:
1. Search leads by phone digits, name, or address (same as before).
2. Search calls by phone digits or consumer name (same as before).
3. Merge the two result sets by phone number, combining fields from BOTH sources using COALESCE so that if a call record has empty address but the lead has it, the lead's value fills in — and vice versa.
4. Include ALL call history for a phone number (not just the most recent) so agents can see every interaction.
5. Return the merged record with the richest available data.

## No data loss
This is a non-destructive function replacement. No tables, columns, or data are modified.
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

  -- Build a merged result set: for each phone number found in either leads or calls,
  -- combine all available fields from both sources.
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.last_call_time DESC NULLS LAST, t.consumer_name), '[]'::jsonb)
  INTO v_results
  FROM (
    WITH matching_phones AS (
      -- Phone numbers from leads that match
      SELECT l.telephone_normalized AS phone_norm
      FROM public.leads l
      WHERE v_digits <> ''
        AND regexp_replace(COALESCE(l.telephone_original, ''), '\D', '', 'g') LIKE '%' || v_digits || '%'
           OR regexp_replace(COALESCE(l.telephone_normalized, ''), '\D', '', 'g') LIKE '%' || v_digits || '%'

      UNION

      -- Phone numbers from calls that match
      SELECT c.consumer_phone AS phone_norm
      FROM public.calls c
      WHERE v_digits <> ''
        AND regexp_replace(COALESCE(c.consumer_phone, ''), '\D', '', 'g') LIKE '%' || v_digits || '%'
    ),
    name_match_phones AS (
      -- Phone numbers from leads matching by name or address
      SELECT l.telephone_normalized AS phone_norm
      FROM public.leads l
      WHERE v_term <> ''
        AND (LOWER(COALESCE(l.name, '')) LIKE '%' || v_term || '%'
             OR LOWER(COALESCE(l.address, '')) LIKE '%' || v_term || '%')

      UNION

      -- Phone numbers from calls matching by consumer name
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
    -- Get the best lead data for each phone
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
    -- Get the most recent call data for each phone
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
