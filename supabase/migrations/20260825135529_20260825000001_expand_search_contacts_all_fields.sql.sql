/*
# Expand search_contacts — return ALL available lead and call data

## Problem
Agents searching for contacts were not seeing the full picture. The search function
was returning a subset of fields, missing: call transcript, recording URL, call duration,
agent notes, agent disposition, callback status, transfer status, DNC status, total call
count, and priority lead flag.

## Fix
Expand search_contacts to return every available field from both leads and calls:
- Lead fields: address, income_range, home_value, property_information, notes,
  original_agent_information, custom_fields, source, status, is_priority, created_at
- Call fields: most recent call's queue, disposition, ai_summary, transcript,
  recording_url, duration_seconds, agent_notes, agent_disposition, callback_requested,
  transfer_status, is_dnc, is_wrong_number, is_completed, created_at
- Aggregated: total_call_count (how many times this number has been called)
- Merged: COALESCE call consumer fields with lead fields so no data is lost

Non-destructive: function replacement only, no data changes.
*/

CREATE OR REPLACE FUNCTION public.search_contacts(p_search text DEFAULT '', p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_digits text;
  v_term text;
  v_term_norm text;
  v_results jsonb;
BEGIN
  v_term := LOWER(TRIM(COALESCE(p_search, '')));
  v_digits := regexp_replace(COALESCE(p_search, ''), '\D', '', 'g');
  v_term_norm := regexp_replace(LOWER(COALESCE(p_search, '')), '[,\.]', ' ', 'g');
  v_term_norm := regexp_replace(v_term_norm, '\s+', ' ', 'g');
  v_term_norm := TRIM(v_term_norm);

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
      WHERE v_term_norm <> ''
        AND (
          LOWER(COALESCE(l.name, '')) LIKE '%' || v_term || '%'
          OR regexp_replace(
               regexp_replace(LOWER(COALESCE(l.address, '')), '[,\.]', ' ', 'g'),
               '\s+', ' ', 'g'
             ) LIKE '%' || v_term_norm || '%'
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
        l.original_agent_information AS lead_orig_agent_info,
        l.custom_fields AS lead_custom_fields,
        l.source AS lead_source,
        l.status AS lead_status,
        l.is_priority,
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
        c.consumer_custom_fields AS call_custom_fields,
        c.queue AS call_queue,
        c.disposition AS call_disposition,
        c.agent_disposition AS call_agent_disposition,
        c.agent_notes AS call_agent_notes,
        c.ai_summary AS call_ai_summary,
        c.transcript AS call_transcript,
        c.recording_url AS call_recording_url,
        c.duration_seconds AS call_duration,
        c.transfer_status AS call_transfer_status,
        c.callback_requested AS call_callback_requested,
        c.is_dnc AS call_is_dnc,
        c.is_wrong_number AS call_is_wrong_number,
        c.is_completed AS call_is_completed,
        c.created_at AS call_created_at,
        c.agent_id
      FROM public.calls c
      WHERE c.consumer_phone IN (SELECT phone_norm FROM all_matching_phones)
      ORDER BY c.consumer_phone, c.created_at DESC
    ),
    call_counts AS (
      SELECT c.consumer_phone, count(*) AS total_calls
      FROM public.calls c
      WHERE c.consumer_phone IN (SELECT phone_norm FROM all_matching_phones)
      GROUP BY c.consumer_phone
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
      COALESCE(NULLIF(ld.lead_notes, ''), NULLIF(cd.call_agent_notes, ''), '') AS notes,
      ld.lead_orig_agent_info AS original_agent_information,
      COALESCE(ld.lead_custom_fields, cd.call_custom_fields, '{}'::jsonb) AS custom_fields,
      ld.lead_source AS lead_source,
      ld.lead_status AS lead_status,
      ld.is_priority,
      COALESCE(ld.lead_created_at, cd.call_created_at) AS created_at,
      cd.call_queue AS call_queue,
      cd.call_disposition AS call_disposition,
      cd.call_agent_disposition AS agent_disposition,
      cd.call_agent_notes AS agent_notes,
      cd.call_created_at AS last_call_time,
      cd.call_ai_summary AS ai_summary,
      cd.call_transcript AS transcript,
      cd.call_recording_url AS recording_url,
      cd.call_duration AS duration_seconds,
      cd.call_transfer_status AS transfer_status,
      cd.call_callback_requested AS callback_requested,
      cd.call_is_dnc AS is_dnc,
      cd.call_is_wrong_number AS is_wrong_number,
      cd.call_is_completed AS is_completed,
      ag.full_name AS agent_name,
      COALESCE(cc.total_calls, 0) AS total_call_count
    FROM all_matching_phones amp
    LEFT JOIN lead_data ld ON ld.telephone_normalized = amp.phone_norm
    LEFT JOIN call_data cd ON cd.consumer_phone = amp.phone_norm
    LEFT JOIN call_counts cc ON cc.consumer_phone = amp.phone_norm
    LEFT JOIN public.agents ag ON cd.agent_id = ag.id
    WHERE ld.lead_id IS NOT NULL OR cd.call_id IS NOT NULL
    LIMIT p_limit
  ) t;

  RETURN jsonb_build_object('results', v_results, 'count', jsonb_array_length(v_results));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.search_contacts FROM anon;
GRANT EXECUTE ON FUNCTION public.search_contacts TO authenticated;
