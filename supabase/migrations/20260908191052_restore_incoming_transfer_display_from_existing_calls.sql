-- Populate the incoming-transfer response from the call itself even when no
-- transfer_context row was created. Keep the existing response keys and add
-- the created_at / agent_name aliases required by IncomingTransferPanel.
CREATE OR REPLACE FUNCTION public.get_active_transfers(p_agent_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC), '[]'::jsonb)
FROM (
  SELECT
    COALESCE(tc.id, c.id) AS id, c.id AS call_id,
    COALESCE(NULLIF(tc.phone_normalized,''), NULLIF(c.consumer_phone,''), c.to_number) AS phone_normalized,
    COALESCE(NULLIF(c.consumer_name,''), NULLIF(tc.consumer_name,''), l.name, '') AS consumer_name,
    COALESCE(NULLIF(c.consumer_phone,''), tc.consumer_phone, '') AS consumer_phone,
    COALESCE(NULLIF(c.consumer_address,''), NULLIF(tc.consumer_address,''), l.address, '') AS consumer_address,
    COALESCE(NULLIF(c.consumer_home_value,''), NULLIF(tc.consumer_home_value,''), l.home_value, '') AS consumer_home_value,
    COALESCE(NULLIF(c.consumer_income_range,''), NULLIF(tc.consumer_income_range,''), l.income_range, '') AS consumer_income_range,
    COALESCE(NULLIF(c.consumer_property_info,''), NULLIF(tc.consumer_property_info,''), l.property_information, '') AS consumer_property_info,
    COALESCE(NULLIF(c.consumer_custom_fields,'{}'::jsonb), NULLIF(tc.consumer_custom_fields,'{}'::jsonb), l.custom_fields, '{}'::jsonb) AS consumer_custom_fields,
    COALESCE(tc.previous_calls,0) AS previous_calls,
    COALESCE(tc.last_disposition,'') AS last_disposition, tc.last_call_at,
    CASE
      WHEN c.transfer_state='transfer_failed' THEN 'failed'
      WHEN c.is_completed OR c.transfer_state='bridge_ended' THEN 'ended'
      WHEN c.bridge_confirmed THEN 'connected'
      ELSE 'pending'
    END AS transfer_status,
    COALESCE(tc.context_created_at,c.transfer_requested_at,c.destination_dialed_at,c.created_at) AS context_created_at,
    c.transfer_requested_at,
    COALESCE(c.destination_dialed_at,tc.talkroute_dialed_at) AS talkroute_dialed_at,
    COALESCE(NULLIF(tc.lead_source,''),l.source,'') AS lead_source,
    COALESCE(NULLIF(tc.notes,''),l.notes,'') AS notes,
    COALESCE(NULLIF(tc.source_agent_name,''),a.full_name,'') AS source_agent_name,
    COALESCE(a.full_name,'') AS agent_name,
    COALESCE(c.transfer_requested_at,tc.context_created_at,c.destination_dialed_at,c.created_at) AS created_at,
    tc.resolved_at,
    c.recording_url,c.transcript,c.duration_seconds,c.queue AS call_queue,
    c.transfer_state AS call_transfer_state,c.bridge_confirmed,c.talkroute_answered
  FROM public.calls c
  LEFT JOIN public.transfer_context tc ON tc.call_id=c.id
  LEFT JOIN public.agents a ON a.id=c.agent_id
  LEFT JOIN public.leads l ON l.id=c.lead_id
  WHERE c.agent_id=p_agent_id
    AND tc.resolved_at IS NULL
    AND (tc.id IS NOT NULL OR c.transfer_state<>'none' OR c.talkroute_leg_created OR c.transfer_requested_at IS NOT NULL)
    AND COALESCE(c.transfer_requested_at,tc.context_created_at,c.destination_dialed_at,c.created_at) > now()-interval '30 minutes'
  ORDER BY COALESCE(c.transfer_requested_at,tc.context_created_at,c.destination_dialed_at,c.created_at) DESC
  LIMIT 100
) t;
$function$;


-- Database-only checks; all fixtures are rolled back before returning.
DO $test$
DECLARE
  v_agent uuid;
  v_other_agent uuid;
  v_request uuid := gen_random_uuid();
  v_ended uuid := gen_random_uuid();
  v_connected uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_plain uuid := gen_random_uuid();
  v_resolved uuid := gen_random_uuid();
  v_old uuid := gen_random_uuid();
  v_data jsonb;
  v_item jsonb;
BEGIN
  SELECT id INTO v_agent FROM public.agents ORDER BY created_at LIMIT 1;
  SELECT id INTO v_other_agent FROM public.agents WHERE id<>v_agent ORDER BY created_at LIMIT 1;
  IF v_agent IS NULL OR v_other_agent IS NULL THEN RAISE EXCEPTION 'Two existing agents required for scoped regression checks'; END IF;
  BEGIN
    INSERT INTO public.calls(id,agent_id,provider_call_id,consumer_name,consumer_phone,consumer_address,
      consumer_custom_fields,transfer_state,talkroute_leg_created,transfer_requested_at,created_at,is_completed,bridge_confirmed)
    VALUES
      (v_request,v_agent,'codex-regression-'||v_request,'Regression contact','+12025550100','Fixture address',
       '{"fixture":"snapshot retained"}','transfer_api_accepted',true,now()-interval '1 minute',now()-interval '2 hours',false,false),
      (v_ended,v_agent,'codex-regression-'||v_ended,'Ended fixture','+12025550101','',
       '{}','destination_ringing',true,now(),now(),true,false),
      (v_connected,v_agent,'codex-regression-'||v_connected,'Connected fixture','+12025550102','',
       '{}','human_answered',true,now(),now(),false,true),
      (v_other,v_other_agent,'codex-regression-'||v_other,'Other agent fixture','+12025550103','',
       '{}','transfer_api_accepted',true,now(),now(),false,false),
      (v_plain,v_agent,'codex-regression-'||v_plain,'Not transferring','+12025550104','',
       '{}','none',false,null,now(),false,false),
      (v_resolved,v_agent,'codex-regression-'||v_resolved,'Dismissed fixture','+12025550105','',
       '{}','transfer_api_accepted',true,now(),now(),false,false),
      (v_old,v_agent,'codex-regression-'||v_old,'Old transfer fixture','+12025550106','',
       '{}','transfer_api_accepted',true,now()-interval '45 minutes',now()-interval '2 hours',false,false);

    INSERT INTO public.transfer_context(call_id,phone_normalized,agent_id,resolved_at)
    VALUES (v_resolved,'+12025550105',v_agent,now());

    v_data := public.get_active_transfers(v_agent);
    SELECT value INTO v_item FROM jsonb_array_elements(v_data) WHERE value->>'call_id'=v_request::text;
    IF v_item IS NULL OR v_item->>'consumer_name'<>'Regression contact'
      OR v_item->>'consumer_address'<>'Fixture address'
      OR v_item->'consumer_custom_fields'->>'fixture'<>'snapshot retained' THEN
      RAISE EXCEPTION 'Missing transfer_context must not hide the call snapshot';
    END IF;
    IF v_item->>'created_at' IS NULL OR v_item->>'agent_name' IS NULL
      OR v_item->>'transfer_status'<>'pending' THEN
      RAISE EXCEPTION 'Transfer aliases or unconfirmed transfer label incorrect';
    END IF;
    IF (v_item->>'created_at')::timestamptz < now()-interval '5 minutes' THEN
      RAISE EXCEPTION 'Long provider queue time must not hide a recent transfer';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_data) x WHERE x->>'call_id'=v_connected::text AND x->>'transfer_status'='connected') THEN
      RAISE EXCEPTION 'Confirmed bridge must display connected';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_data) x WHERE x->>'call_id'=v_ended::text AND x->>'transfer_status'='ended') THEN
      RAISE EXCEPTION 'Completed call must not display as a live connection';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_data) x WHERE x->>'call_id' IN (v_other::text,v_plain::text,v_resolved::text,v_old::text)) THEN
      RAISE EXCEPTION 'Agent scoping, nontransfer, resolved, or old-call filtering failed';
    END IF;

    RAISE EXCEPTION USING ERRCODE='PT001', MESSAGE='regression fixtures rollback';
  EXCEPTION WHEN SQLSTATE 'PT001' THEN NULL;
  END;
END;
$test$;
