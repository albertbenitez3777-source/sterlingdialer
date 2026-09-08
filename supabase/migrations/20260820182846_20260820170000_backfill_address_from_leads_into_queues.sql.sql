/*
# Always show address, income, and home value on every call card

1. Changes
- Rewrites `get_agent_queues` to LEFT JOIN `leads` on `lead_id` (falling back to
  a phone-number match when `lead_id` is null) and COALESCE the address,
  income_range, home_value, and property_information fields from the lead when
  the call record's own consumer_* field is empty.
- Rewrites the calls portion of `search_contacts` to do the same LEFT JOIN +
  COALESCE so contact search results also show the address even when the call
  record itself has a blank consumer_address.
- No new tables, no new columns, no security changes.

2. Rationale
- Many call records were created with blank consumer_address/income/home_value
  fields (especially priority_recall leads that were imported without address
  data). The linked lead often DOES have the address. By joining to the lead
  and falling back, agents always see the address whenever it exists anywhere
  in the system.
*/

CREATE OR REPLACE FUNCTION public.get_agent_queues(p_agent_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_human_drop jsonb;
  v_fire_transfers jsonb;
  v_voice_messages jsonb;
  v_week_start timestamptz;
BEGIN
  v_week_start := date_trunc('week', now());

  SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.created_at DESC), '[]'::jsonb)
  INTO v_human_drop
  FROM (
    SELECT
      c.id, c.consumer_name, c.consumer_phone,
      COALESCE(NULLIF(c.consumer_address, ''), NULLIF(l.address, ''), '') AS consumer_address,
      COALESCE(NULLIF(c.consumer_home_value, ''), NULLIF(l.home_value, ''), '') AS consumer_home_value,
      COALESCE(NULLIF(c.consumer_income_range, ''), NULLIF(l.income_range, ''), '') AS consumer_income_range,
      COALESCE(NULLIF(c.consumer_property_info, ''), NULLIF(l.property_information, ''), '') AS consumer_property_info,
      c.consumer_custom_fields,
      c.call_direction, c.duration_seconds, c.ai_summary, c.transcript, c.recording_url,
      c.callback_requested, c.transfer_failure_reason, c.agent_disposition, c.agent_notes,
      c.is_completed, c.is_dnc, c.is_wrong_number, c.created_at, c.transfer_status,
      c.originating_bland_number, c.talkroute_destination
    FROM public.calls c
    LEFT JOIN public.leads l ON l.id = c.lead_id
      OR (c.lead_id IS NULL AND l.telephone_normalized = c.consumer_phone)
    WHERE c.agent_id = p_agent_id AND c.queue = 'human_drop'
      AND c.created_at >= v_week_start
  ) r;

  SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.created_at DESC), '[]'::jsonb)
  INTO v_fire_transfers
  FROM (
    SELECT
      c.id, c.consumer_name, c.consumer_phone,
      COALESCE(NULLIF(c.consumer_address, ''), NULLIF(l.address, ''), '') AS consumer_address,
      COALESCE(NULLIF(c.consumer_home_value, ''), NULLIF(l.home_value, ''), '') AS consumer_home_value,
      COALESCE(NULLIF(c.consumer_income_range, ''), NULLIF(l.income_range, ''), '') AS consumer_income_range,
      COALESCE(NULLIF(c.consumer_property_info, ''), NULLIF(l.property_information, ''), '') AS consumer_property_info,
      c.consumer_custom_fields,
      c.call_direction, c.duration_seconds, c.ai_summary, c.transcript, c.recording_url,
      c.agent_disposition, c.agent_notes, c.is_completed, c.created_at,
      c.originating_bland_number, c.talkroute_destination,
      c.transfer_requested_at, c.talkroute_answered_at, c.bridge_confirmed_at,
      c.ai_terminated_at, c.talkroute_answered, c.bridge_confirmed, c.ai_terminated
    FROM public.calls c
    LEFT JOIN public.leads l ON l.id = c.lead_id
      OR (c.lead_id IS NULL AND l.telephone_normalized = c.consumer_phone)
    WHERE c.agent_id = p_agent_id AND c.queue = 'fire_transfer'
      AND c.created_at >= v_week_start
  ) r;

  SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.created_at DESC), '[]'::jsonb)
  INTO v_voice_messages
  FROM (
    SELECT id, consumer_name, consumer_phone, ai_summary, transcript, recording_url,
    voicemail_status, voicemail_urgency, requested_callback_time,
    agent_notes, created_at, call_direction
    FROM public.calls
    WHERE agent_id = p_agent_id AND queue = 'voice_message'
    AND created_at >= v_week_start
  ) r;

  RETURN jsonb_build_object(
    'human_drop', v_human_drop,
    'fire_transfers', v_fire_transfers,
    'voice_messages', v_voice_messages
  );
END;
$function$;


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

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO v_calls
  FROM (
    SELECT DISTINCT ON (c.consumer_phone)
      'call'::text as source,
      c.id,
      c.consumer_name,
      c.consumer_phone as phone,
      c.consumer_phone as phone_normalized,
      COALESCE(NULLIF(c.consumer_address, ''), NULLIF(l.address, ''), '') AS address,
      COALESCE(NULLIF(c.consumer_income_range, ''), NULLIF(l.income_range, ''), '') AS income_range,
      COALESCE(NULLIF(c.consumer_home_value, ''), NULLIF(l.home_value, ''), '') AS home_value,
      COALESCE(NULLIF(c.consumer_property_info, ''), NULLIF(l.property_information, ''), '') AS property_information,
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
    LEFT JOIN public.leads l ON l.id = c.lead_id
      OR (c.lead_id IS NULL AND l.telephone_normalized = c.consumer_phone)
    WHERE
      COALESCE(c.consumer_phone, '') <> ''
      AND (
        (v_digits <> '' AND regexp_replace(COALESCE(c.consumer_phone, ''), '\D', '', 'g') LIKE '%' || v_digits || '%')
        OR (v_term <> '' AND LOWER(COALESCE(c.consumer_name, '')) LIKE '%' || v_term || '%')
      )
    ORDER BY c.consumer_phone, c.created_at DESC
    LIMIT p_limit
  ) t;

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
