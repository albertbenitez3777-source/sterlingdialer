/*
# v261 fix: Restructure search_contacts to use single-query CTE

## Summary
Fixes the "relation merged does not exist" error by combining count + results
into a single CTE-based query instead of two separate statements referencing
the same CTE.
*/

CREATE OR REPLACE FUNCTION public.search_contacts(
  p_search text DEFAULT '',
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_digits text;
  v_digits10 text;
  v_term text;
  v_term_norm text;
  v_results jsonb;
  v_total integer;
BEGIN
  v_term := LOWER(TRIM(COALESCE(p_search, '')));
  v_digits := regexp_replace(COALESCE(p_search, ''), '\D', '', 'g');
  v_digits10 := right(v_digits, 10);
  v_term_norm := regexp_replace(LOWER(COALESCE(p_search, '')), '[,\.]', ' ', 'g');
  v_term_norm := regexp_replace(v_term_norm, '\s+', ' ', 'g');
  v_term_norm := TRIM(v_term_norm);

  IF v_term = '' AND v_digits = '' THEN
    RETURN jsonb_build_object('results', '[]'::jsonb, 'count', 0, 'total', 0);
  END IF;

  -- Get total count first
  WITH matching_phones AS (
    SELECT DISTINCT phone_last10(l.telephone_normalized) AS canon
    FROM public.leads l
    WHERE v_digits10 <> '' AND length(v_digits10) >= 3
      AND phone_last10(l.telephone_normalized) LIKE '%' || v_digits10 || '%'
    UNION
    SELECT DISTINCT phone_last10(c.consumer_phone) AS canon
    FROM public.calls c
    WHERE v_digits10 <> '' AND length(v_digits10) >= 3
      AND phone_last10(c.consumer_phone) LIKE '%' || v_digits10 || '%'
    UNION
    SELECT DISTINCT phone_last10(l.telephone_normalized) AS canon
    FROM public.leads l
    WHERE v_term_norm <> '' AND length(v_term_norm) >= 2
      AND (
        LOWER(COALESCE(l.name, '')) LIKE '%' || v_term || '%'
        OR regexp_replace(
            regexp_replace(LOWER(COALESCE(l.address, '')), '[,\.]', ' ', 'g'),
            '\s+', ' ', 'g'
          ) LIKE '%' || v_term_norm || '%'
      )
    UNION
    SELECT DISTINCT phone_last10(c.consumer_phone) AS canon
    FROM public.calls c
    WHERE v_term <> '' AND length(v_term) >= 2
      AND LOWER(COALESCE(c.consumer_name, '')) LIKE '%' || v_term || '%'
  ),
  filtered_phones AS (
    SELECT canon FROM matching_phones
    WHERE canon IS NOT NULL AND canon <> '' AND length(canon) >= 7
  )
  SELECT count(*) INTO v_total FROM filtered_phones;

  -- Now get the paged results
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO v_results
  FROM (
    WITH matching_phones AS (
      SELECT DISTINCT phone_last10(l.telephone_normalized) AS canon
      FROM public.leads l
      WHERE v_digits10 <> '' AND length(v_digits10) >= 3
        AND phone_last10(l.telephone_normalized) LIKE '%' || v_digits10 || '%'
      UNION
      SELECT DISTINCT phone_last10(c.consumer_phone) AS canon
      FROM public.calls c
      WHERE v_digits10 <> '' AND length(v_digits10) >= 3
        AND phone_last10(c.consumer_phone) LIKE '%' || v_digits10 || '%'
      UNION
      SELECT DISTINCT phone_last10(l.telephone_normalized) AS canon
      FROM public.leads l
      WHERE v_term_norm <> '' AND length(v_term_norm) >= 2
        AND (
          LOWER(COALESCE(l.name, '')) LIKE '%' || v_term || '%'
          OR regexp_replace(
              regexp_replace(LOWER(COALESCE(l.address, '')), '[,\.]', ' ', 'g'),
              '\s+', ' ', 'g'
            ) LIKE '%' || v_term_norm || '%'
        )
      UNION
      SELECT DISTINCT phone_last10(c.consumer_phone) AS canon
      FROM public.calls c
      WHERE v_term <> '' AND length(v_term) >= 2
        AND LOWER(COALESCE(c.consumer_name, '')) LIKE '%' || v_term || '%'
    ),
    filtered_phones AS (
      SELECT canon FROM matching_phones
      WHERE canon IS NOT NULL AND canon <> '' AND length(canon) >= 7
    ),
    lead_data AS (
      SELECT DISTINCT ON (phone_last10(l.telephone_normalized))
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
        l.created_at AS lead_created_at,
        phone_last10(l.telephone_normalized) AS canon
      FROM public.leads l
      WHERE phone_last10(l.telephone_normalized) IN (SELECT canon FROM filtered_phones)
      ORDER BY phone_last10(l.telephone_normalized), l.created_at DESC
    ),
    call_data AS (
      SELECT DISTINCT ON (phone_last10(c.consumer_phone))
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
        c.agent_id,
        phone_last10(c.consumer_phone) AS canon
      FROM public.calls c
      WHERE phone_last10(c.consumer_phone) IN (SELECT canon FROM filtered_phones)
      ORDER BY phone_last10(c.consumer_phone), c.created_at DESC
    ),
    call_counts AS (
      SELECT phone_last10(c.consumer_phone) AS canon, count(*) AS total_calls
      FROM public.calls c
      WHERE phone_last10(c.consumer_phone) IN (SELECT canon FROM filtered_phones)
      GROUP BY phone_last10(c.consumer_phone)
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
    FROM filtered_phones fp
    LEFT JOIN lead_data ld ON ld.canon = fp.canon
    LEFT JOIN call_data cd ON cd.canon = fp.canon
    LEFT JOIN call_counts cc ON cc.canon = fp.canon
    LEFT JOIN public.agents ag ON cd.agent_id = ag.id
    WHERE ld.lead_id IS NOT NULL OR cd.call_id IS NOT NULL
    ORDER BY cd.call_created_at DESC NULLS LAST, COALESCE(cd.call_name, ld.lead_name, 'Unknown')
    LIMIT p_limit OFFSET p_offset
  ) t;

  RETURN jsonb_build_object('results', v_results, 'count', jsonb_array_length(v_results), 'total', v_total);
END;
$function$;
