/*
# Filter agent queues to current week only

1. Changes
- Modified `get_agent_queues` function to only return calls from the current week
  (created_at >= the most recent Monday at 00:00).
- Human Drop Inbox: only this week's live human contacts
- Fire Transfers: only this week's successful transfers
- Voice Messages: only this week's voicemails
- Admin views (Fire Leads, Lead Pool) are unaffected — they use separate functions.
- Secretary call history is filtered separately in the wolf-secretary edge function.

2. Rationale
- Agents should only see their current week's contacts, not the full historical archive.
- The list refreshes every Monday — date_trunc('week', now()) gives Monday 00:00.
- Admin retains full visibility through their own dedicated views.
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
-- Start of the current ISO week (Monday 00:00)
v_week_start := date_trunc('week', now());

SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.created_at DESC), '[]'::jsonb)
INTO v_human_drop
FROM (
SELECT id, consumer_name, consumer_phone, consumer_address, consumer_home_value,
consumer_income_range, consumer_property_info, consumer_custom_fields,
call_direction, duration_seconds, ai_summary, transcript, recording_url,
callback_requested, transfer_failure_reason, agent_disposition, agent_notes,
is_completed, is_dnc, is_wrong_number, created_at, transfer_status,
originating_bland_number, talkroute_destination
FROM public.calls
WHERE agent_id = p_agent_id AND queue = 'human_drop'
AND created_at >= v_week_start
) r;

SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.created_at DESC), '[]'::jsonb)
INTO v_fire_transfers
FROM (
SELECT id, consumer_name, consumer_phone, consumer_address, consumer_home_value,
consumer_income_range, consumer_property_info, consumer_custom_fields,
call_direction, duration_seconds, ai_summary, transcript, recording_url,
agent_disposition, agent_notes, is_completed, created_at,
originating_bland_number, talkroute_destination,
transfer_requested_at, talkroute_answered_at, bridge_confirmed_at,
ai_terminated_at, talkroute_answered, bridge_confirmed, ai_terminated
FROM public.calls
WHERE agent_id = p_agent_id AND queue = 'fire_transfer'
AND created_at >= v_week_start
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