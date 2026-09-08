/*
# Fix gen_random_bytes in insert_test_call
Replaces gen_random_bytes with gen_random_uuid for provider call ID generation.
*/
CREATE OR REPLACE FUNCTION public.insert_test_call(
  p_agent_id uuid,
  p_queue text,
  p_consumer_name text DEFAULT 'Test Consumer',
  p_consumer_phone text DEFAULT '(555) 000-0000',
  p_call_direction text DEFAULT 'outbound',
  p_is_live_human boolean DEFAULT true,
  p_human_agreed_transfer boolean DEFAULT false,
  p_talkroute_leg_created boolean DEFAULT false,
  p_talkroute_answered boolean DEFAULT false,
  p_bridge_confirmed boolean DEFAULT false,
  p_ai_terminated boolean DEFAULT false,
  p_has_post_transfer_ai_speech boolean DEFAULT false,
  p_transfer_failure_reason text DEFAULT '',
  p_ai_summary text DEFAULT '',
  p_transcript text DEFAULT '',
  p_recording_url text DEFAULT '',
  p_duration_seconds integer DEFAULT 0,
  p_voicemail_status text DEFAULT 'new',
  p_voicemail_urgency text DEFAULT 'normal',
  p_callback_requested boolean DEFAULT false,
  p_consumer_address text DEFAULT '',
  p_consumer_home_value text DEFAULT '',
  p_consumer_income_range text DEFAULT '',
  p_consumer_property_info text DEFAULT '',
  p_consumer_custom_fields jsonb DEFAULT '{}'::jsonb,
  p_originating_bland_number text DEFAULT '',
  p_talkroute_destination text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_call_id uuid;
  v_provider_call_id text;
BEGIN
  v_provider_call_id := 'test_' || replace(gen_random_uuid()::text, '-', '');
  v_call_id := gen_random_uuid();

  INSERT INTO public.calls (
    id, agent_id, provider_call_id, queue, call_direction,
    is_live_human, human_agreed_transfer, talkroute_leg_created,
    talkroute_answered, bridge_confirmed, ai_terminated,
    has_post_transfer_ai_speech, transfer_failure_reason,
    ai_summary, transcript, recording_url, duration_seconds,
    voicemail_status, voicemail_urgency, callback_requested,
    consumer_name, consumer_phone, consumer_address,
    consumer_home_value, consumer_income_range, consumer_property_info,
    consumer_custom_fields, originating_bland_number, talkroute_destination,
    transfer_status, disposition, created_at
  )
  VALUES (
    v_call_id, p_agent_id, v_provider_call_id, p_queue, p_call_direction,
    p_is_live_human, p_human_agreed_transfer, p_talkroute_leg_created,
    p_talkroute_answered, p_bridge_confirmed, p_ai_terminated,
    p_has_post_transfer_ai_speech, p_transfer_failure_reason,
    p_ai_summary, p_transcript, p_recording_url, p_duration_seconds,
    p_voicemail_status, p_voicemail_urgency, p_callback_requested,
    p_consumer_name, p_consumer_phone, p_consumer_address,
    p_consumer_home_value, p_consumer_income_range, p_consumer_property_info,
    p_consumer_custom_fields, p_originating_bland_number, p_talkroute_destination,
    CASE
      WHEN p_queue = 'fire_transfer' THEN 'successful'
      WHEN p_queue = 'human_drop' AND p_transfer_failure_reason <> '' THEN 'unsuccessful'
      WHEN p_human_agreed_transfer THEN 'requested'
      ELSE 'none'
    END,
    CASE WHEN p_queue = 'pending' AND NOT p_is_live_human THEN 'no_answer' ELSE '' END,
    now() - (random() * interval '2 hours')
  );

  RETURN v_call_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.insert_test_call FROM anon;
GRANT EXECUTE ON FUNCTION public.insert_test_call TO authenticated;
