/*
# Show all-time transfers and human drops for ALL agents

## Context
Previously only John McCarthy saw all-time history; other agents were week-filtered.
Now all agents see their complete fire_transfer and human_drop history from day 1.

## Change
- Remove the week-start cutoff for fire_transfers and human_drop for every agent
- Voice messages stay week-filtered (unchanged)
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
) r;

-- Voice messages stay week-filtered
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
