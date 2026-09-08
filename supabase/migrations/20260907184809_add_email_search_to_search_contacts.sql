/*
# Add email search to search_contacts

1. Modified Functions
   - `search_contacts`: Now also matches against `custom_fields->>'email'` 
     so agents can search leads by email address.

2. Important Notes
   - Existing phone/name/address search is unchanged.
   - Email match uses ILIKE for case-insensitive partial matching.
*/

CREATE OR REPLACE FUNCTION public.search_contacts(
  p_search text DEFAULT '',
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
SELECT DISTINCT phone_last10(tc.phone_normalized) AS canon
FROM public.transfer_context tc
WHERE v_digits10 <> '' AND length(v_digits10) >= 3
AND phone_last10(tc.phone_normalized) LIKE '%' || v_digits10 || '%'
UNION
SELECT DISTINCT phone_last10(rl.phone_normalized) AS canon
FROM public.retry_leads rl
WHERE v_digits10 <> '' AND length(v_digits10) >= 3
AND phone_last10(rl.phone_normalized) LIKE '%' || v_digits10 || '%'
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
OR LOWER(COALESCE(l.custom_fields->>'email', '')) LIKE '%' || v_term || '%'
)
UNION
SELECT DISTINCT phone_last10(c.consumer_phone) AS canon
FROM public.calls c
WHERE v_term_norm <> '' AND length(v_term_norm) >= 2
AND (
LOWER(COALESCE(c.consumer_name, '')) LIKE '%' || v_term || '%'
OR regexp_replace(
regexp_replace(LOWER(COALESCE(c.consumer_address, '')), '[,\.]', ' ', 'g'),
'\s+', ' ', 'g'
) LIKE '%' || v_term_norm || '%'
OR LOWER(COALESCE(c.consumer_custom_fields->>'email', '')) LIKE '%' || v_term || '%'
)
),
lead_data AS (
SELECT
'lead' AS source,
l.id::text AS id,
l.name AS consumer_name,
l.telephone_original AS phone,
l.telephone_normalized AS phone_normalized,
l.address,
l.income_range,
l.home_value,
l.property_information,
l.notes,
l.original_agent_information,
l.custom_fields AS lead_custom_fields,
l.source AS lead_source,
l.status AS lead_status,
l.created_at,
l.is_priority,
NULL::text AS call_queue,
NULL::text AS call_disposition,
NULL::text AS agent_disposition,
NULL::text AS agent_notes,
NULL::timestamptz AS last_call_time,
NULL::text AS agent_name,
NULL::text AS ai_summary,
NULL::text AS transcript,
NULL::text AS recording_url,
NULL::integer AS duration_seconds,
NULL::text AS transfer_status,
NULL::boolean AS callback_requested,
NULL::boolean AS is_dnc,
NULL::boolean AS is_wrong_number,
NULL::boolean AS is_completed,
0 AS total_call_count
FROM public.leads l
WHERE phone_last10(l.telephone_normalized) IN (SELECT canon FROM matching_phones)
),
call_data AS (
SELECT
'call' AS source,
c.id::text AS id,
c.consumer_name,
c.consumer_phone AS phone,
c.consumer_phone AS phone_normalized,
COALESCE(c.consumer_address, '') AS address,
COALESCE(c.consumer_income_range, '') AS income_range,
COALESCE(c.consumer_home_value, '') AS home_value,
COALESCE(c.consumer_property_info, '') AS property_information,
'' AS notes,
NULL::text AS original_agent_information,
c.consumer_custom_fields AS lead_custom_fields,
'' AS lead_source,
'' AS lead_status,
c.created_at,
false AS is_priority,
c.queue AS call_queue,
c.queue AS call_disposition,
c.agent_disposition,
c.agent_notes,
c.created_at AS last_call_time,
a.full_name AS agent_name,
c.ai_summary,
c.transcript,
c.recording_url,
c.duration_seconds,
c.transfer_status,
c.callback_requested,
c.is_dnc,
c.is_wrong_number,
c.is_completed,
1 AS total_call_count
FROM public.calls c
LEFT JOIN public.agents a ON a.id = c.agent_id
WHERE phone_last10(c.consumer_phone) IN (SELECT canon FROM matching_phones)
),
combined AS (
SELECT DISTINCT ON (phone_last10(phone_normalized))
source, id, consumer_name, phone, phone_normalized, address,
income_range, home_value, property_information, notes,
original_agent_information, lead_custom_fields AS custom_fields,
lead_source, lead_status, created_at, is_priority,
call_queue, call_disposition, agent_disposition, agent_notes,
last_call_time, agent_name, ai_summary, transcript,
recording_url, duration_seconds, transfer_status,
callback_requested, is_dnc, is_wrong_number, is_completed,
(SELECT count(*) FROM public.calls cx
 WHERE phone_last10(cx.consumer_phone) = phone_last10(phone_normalized)
 AND cx.call_direction = 'outbound'
 AND cx.provider_call_id IS NOT NULL AND cx.provider_call_id <> ''
) AS total_call_count
FROM (
SELECT * FROM lead_data
UNION ALL
SELECT * FROM call_data
) all_records
ORDER BY phone_last10(phone_normalized), last_call_time DESC NULLS LAST, created_at DESC
)
SELECT count(*) INTO v_total FROM combined;

SELECT COALESCE(jsonb_agg(row_to_json(c)::jsonb), '[]'::jsonb)
INTO v_results
FROM (SELECT * FROM combined ORDER BY last_call_time DESC NULLS LAST, created_at DESC LIMIT 50 OFFSET p_offset) c;

RETURN jsonb_build_object('results', v_results, 'count', jsonb_array_length(v_results), 'total', v_total);
END;
$$;
