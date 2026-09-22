CREATE OR REPLACE FUNCTION public.dialer_next_batch()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_campaign        record;
v_remaining       integer;
v_calls_placed    integer;
v_results         jsonb[] := ARRAY[]::jsonb[];
v_lead            record;
v_call_id         uuid;
v_agent           record;
v_agent_remaining integer;
v_active          integer;
v_phone_already_called boolean;
v_global_active   integer;
v_global_remaining integer;
v_recent_hour integer;
v_recent_minute integer;
BEGIN
IF NOT pg_try_advisory_xact_lock(217, 1) THEN
RETURN jsonb_build_object('success', true, 'calls', jsonb_build_array(), 'skipped', 'batch_locked');
END IF;

SELECT * INTO v_campaign FROM public.campaigns ORDER BY created_at DESC LIMIT 1;

IF v_campaign.state <> 'running' THEN
RETURN jsonb_build_object('success', false, 'error', 'Campaign is not running');
END IF;

-- 3-minute placeholder cleanup
DELETE FROM public.calls
WHERE call_direction = 'outbound'
AND (provider_call_id IS NULL OR provider_call_id = '')
AND created_at < now() - interval '3 minutes';

-- Call-limit cap
SELECT count(*) INTO v_calls_placed
FROM public.calls
WHERE created_at >= v_campaign.started_at
AND call_direction = 'outbound'
AND provider_call_id IS NOT NULL AND provider_call_id <> '';

v_remaining := v_campaign.provider_call_limit - v_calls_placed;
IF v_remaining <= 0 THEN
RETURN jsonb_build_object('success', true, 'calls_to_dial', 0, 'message', 'Call limit reached');
END IF;

SELECT count(*)::integer,
count(*) FILTER (WHERE created_at >= now()-interval '1 minute')::integer
INTO v_recent_hour, v_recent_minute
FROM public.calls
WHERE call_direction='outbound' AND created_at >= now()-interval '1 hour';

v_remaining := LEAST(v_remaining,
public.dialer_rate_allowance(v_campaign.hourly_call_target,v_recent_hour,v_recent_minute));
IF v_remaining <= 0 THEN
RETURN jsonb_build_object('success',true,'calls',jsonb_build_array(),
'calls_to_dial',0,'skipped','hourly_pacing','hourly_target',v_campaign.hourly_call_target);
END IF;

-- Global concurrency cap (hard ceiling 12)
SELECT count(*) INTO v_global_active
FROM public.calls
WHERE call_direction = 'outbound'
AND queue = 'pending'
AND is_completed = false;

v_global_remaining := LEAST(
GREATEST(LEAST(v_campaign.concurrency, 12) - v_global_active, 0),
v_remaining
);

-- ────────────────────────────────────────────────────────
-- RETRY MODE: pull from retry_leads instead of leads
-- ────────────────────────────────────────────────────────
IF v_campaign.campaign_type = 'retry' THEN
-- Reset stuck in_progress retry_leads
UPDATE public.retry_leads
SET status = 'new'
WHERE status = 'in_progress'
AND NOT EXISTS (
SELECT 1 FROM public.calls c
WHERE c.consumer_phone = retry_leads.phone_normalized
AND c.call_direction = 'outbound'
AND c.provider_call_id IS NOT NULL AND c.provider_call_id <> ''
AND c.created_at >= v_campaign.started_at
)
AND NOT EXISTS (
SELECT 1 FROM public.calls p
WHERE p.consumer_phone = retry_leads.phone_normalized
AND p.call_direction = 'outbound'
AND p.created_at >= now() - interval '3 minutes'
);

FOR v_agent IN
SELECT * FROM public.agents a
WHERE a.active_for_dialer = true
AND a.status = 'active'
AND a.is_owner = false
AND a.available_for_transfer = true
AND public.campaign_agent_can_receive(a.id,v_campaign.id)
AND a.transfer_certified = true
AND a.bland_number IS NOT NULL AND a.bland_number <> ''
AND a.talkroute_number IS NOT NULL AND a.talkroute_number <> ''
ORDER BY (
SELECT count(*) FROM public.calls c
WHERE c.agent_id = a.id AND c.created_at >= v_campaign.started_at
), a.created_at
LOOP
IF v_global_remaining <= 0 OR v_remaining <= 0 THEN EXIT; END IF;

SELECT count(*) INTO v_active
FROM public.calls
WHERE agent_id = v_agent.id AND queue = 'pending' AND is_completed = false;

v_agent_remaining := LEAST(
GREATEST(LEAST(COALESCE(v_agent.dialer_concurrency,3),7) - v_active, 0),
v_global_remaining, v_remaining
);
IF v_agent_remaining <= 0 THEN CONTINUE; END IF;

FOR v_lead IN
SELECT rl.id, rl.phone_normalized, rl.consumer_name, rl.address,
rl.income_range, rl.home_value, rl.property_information, rl.custom_fields
FROM public.retry_leads rl
WHERE rl.status = 'new'
AND rl.exclusion_reason IS NULL
AND NOT EXISTS (SELECT 1 FROM public.calls blocked WHERE public.normalize_phone(blocked.consumer_phone)=public.normalize_phone(rl.phone_normalized) AND (blocked.is_dnc OR blocked.is_wrong_number))
AND NOT EXISTS (
SELECT 1 FROM public.calls c
WHERE c.consumer_phone = rl.phone_normalized
AND c.call_direction = 'outbound'
AND c.provider_call_id IS NOT NULL AND c.provider_call_id <> ''
AND c.created_at >= v_campaign.started_at
)
ORDER BY rl.last_human_at DESC NULLS LAST
FOR UPDATE OF rl SKIP LOCKED
LIMIT v_agent_remaining
LOOP
UPDATE public.retry_leads SET status = 'in_progress', dialed_at = now() WHERE id = v_lead.id;

BEGIN
INSERT INTO public.calls (
lead_id, agent_id, provider, queue, call_direction,
consumer_name, consumer_phone, consumer_address,
consumer_home_value, consumer_income_range, consumer_property_info,
consumer_custom_fields
) VALUES (
NULL, v_agent.id, 'bland.ai', 'pending', 'outbound',
v_lead.consumer_name, v_lead.phone_normalized, v_lead.address,
v_lead.home_value, v_lead.income_range, v_lead.property_information,
COALESCE(v_lead.custom_fields, '{}'::jsonb)
)
RETURNING id INTO v_call_id;

v_results := array_append(v_results, jsonb_build_object(
'call_id', v_call_id, 'retry_lead_id', v_lead.id,
'phone', v_lead.phone_normalized, 'name', v_lead.consumer_name,
'agent_id', v_agent.id, 'agent_name', v_agent.full_name,
'bland_number', v_agent.bland_number, 'bland_phone_id', v_agent.bland_phone_id,
'bland_voice_id', v_agent.bland_voice_id, 'talkroute_number', v_agent.talkroute_number
));

v_remaining := v_remaining - 1;
v_global_remaining := v_global_remaining - 1;
EXCEPTION WHEN unique_violation THEN
UPDATE public.retry_leads SET status = 'closed' WHERE id = v_lead.id;
END;
END LOOP;
END LOOP;

RETURN jsonb_build_object(
'success', true,
'calls_to_dial', jsonb_array_length(to_jsonb(v_results)),
'calls', to_jsonb(v_results),
'mode', 'retry'
);
END IF;

-- ────────────────────────────────────────────────────────
-- STANDARD MODE with AGENT-LEAD ROUTING
-- Eligible leads are distributed fairly across selected agents.
-- ────────────────────────────────────────────────────────

-- Reset stuck leads
UPDATE public.leads
SET status = 'new'
WHERE status = 'in_progress'
AND NOT EXISTS (
SELECT 1 FROM public.calls c
WHERE c.lead_id = leads.id AND c.call_direction = 'outbound'
AND c.provider_call_id IS NOT NULL AND c.provider_call_id <> ''
)
AND NOT EXISTS (
SELECT 1 FROM public.calls p
WHERE p.lead_id = leads.id AND p.call_direction = 'outbound'
AND p.created_at >= now() - interval '3 minutes'
);

-- Close leads already dialed (but NOT force_redial leads)
UPDATE public.leads SET status = 'closed'
WHERE status IN ('new','in_progress')
AND telephone_normalized <> ''
AND force_redial IS NOT TRUE
AND EXISTS (
SELECT 1 FROM public.calls c
WHERE c.consumer_phone = leads.telephone_normalized
AND c.call_direction = 'outbound'
AND c.provider_call_id IS NOT NULL AND c.provider_call_id <> ''
);

FOR v_agent IN
SELECT * FROM public.agents a
WHERE a.active_for_dialer = true
AND a.status = 'active'
AND a.is_owner = false
AND a.available_for_transfer = true
AND public.campaign_agent_can_receive(a.id,v_campaign.id)
AND a.transfer_certified = true
AND a.bland_number IS NOT NULL AND a.bland_number <> ''
AND a.talkroute_number IS NOT NULL AND a.talkroute_number <> ''
ORDER BY (
SELECT count(*) FROM public.calls c
WHERE c.agent_id = a.id AND c.created_at >= v_campaign.started_at
), a.created_at
LOOP
IF v_global_remaining <= 0 OR v_remaining <= 0 THEN EXIT; END IF;

SELECT count(*) INTO v_active
FROM public.calls
WHERE agent_id = v_agent.id AND queue = 'pending' AND is_completed = false;

v_agent_remaining := LEAST(
GREATEST(LEAST(COALESCE(v_agent.dialer_concurrency,3),7) - v_active, 0),
v_global_remaining, v_remaining
);
IF v_agent_remaining <= 0 THEN CONTINUE; END IF;

FOR v_lead IN
SELECT l.id, l.name, l.telephone_original, l.telephone_normalized,
l.address, l.income_range, l.home_value, l.property_information,
l.notes, l.source, l.custom_fields, l.retry_count, l.next_eligible_at,
l.force_redial
FROM public.leads l
WHERE l.status = 'new'
AND NOT EXISTS (SELECT 1 FROM public.calls blocked WHERE public.normalize_phone(blocked.consumer_phone)=public.normalize_phone(l.telephone_normalized) AND (blocked.is_dnc OR blocked.is_wrong_number))
AND l.telephone_normalized <> ''
AND (l.next_eligible_at IS NULL OR l.next_eligible_at <= now())
-- All active agents share the eligible pool; preserve DNC, wrong-number,
-- retry-date and previously-dialed exclusions below.
AND (
l.force_redial = true
OR NOT EXISTS (
SELECT 1 FROM public.calls c
WHERE c.consumer_phone = l.telephone_normalized
AND c.call_direction = 'outbound'
AND c.provider_call_id IS NOT NULL AND c.provider_call_id <> ''
)
)
ORDER BY l.created_at ASC
FOR UPDATE OF l SKIP LOCKED
LIMIT v_agent_remaining
LOOP
IF v_lead.force_redial IS NOT TRUE THEN
SELECT EXISTS(
SELECT 1 FROM public.calls c
WHERE c.consumer_phone = v_lead.telephone_normalized
AND c.call_direction = 'outbound'
AND c.provider_call_id IS NOT NULL AND c.provider_call_id <> ''
) INTO v_phone_already_called;

IF v_phone_already_called THEN
UPDATE public.leads SET status = 'closed' WHERE id = v_lead.id;
CONTINUE;
END IF;
END IF;

UPDATE public.leads SET status = 'in_progress', force_redial = false WHERE id = v_lead.id;

BEGIN
INSERT INTO public.calls (
lead_id, agent_id, provider, queue, call_direction,
consumer_name, consumer_phone, consumer_address,
consumer_home_value, consumer_income_range, consumer_property_info,
consumer_custom_fields
) VALUES (
v_lead.id, v_agent.id, 'bland.ai', 'pending', 'outbound',
v_lead.name, v_lead.telephone_normalized, v_lead.address,
v_lead.home_value, v_lead.income_range, v_lead.property_information,
COALESCE(v_lead.custom_fields, '{}'::jsonb)
)
RETURNING id INTO v_call_id;

v_results := array_append(v_results, jsonb_build_object(
'call_id', v_call_id, 'lead_id', v_lead.id, 'force_redial', coalesce(v_lead.force_redial,false),
'phone', v_lead.telephone_normalized, 'name', v_lead.name,
'agent_id', v_agent.id, 'agent_name', v_agent.full_name,
'bland_number', v_agent.bland_number, 'bland_phone_id', v_agent.bland_phone_id,
'bland_voice_id', v_agent.bland_voice_id, 'talkroute_number', v_agent.talkroute_number,
'agent_direct_number', v_agent.agent_direct_number
));

v_remaining := v_remaining - 1;
v_global_remaining := v_global_remaining - 1;
EXCEPTION WHEN unique_violation THEN
UPDATE public.leads SET status = 'closed' WHERE id = v_lead.id;
END;
END LOOP;
END LOOP;

RETURN jsonb_build_object(
'success', true,
'calls_to_dial', jsonb_array_length(to_jsonb(v_results)),
'calls', to_jsonb(v_results)
);
END;
$function$;


CREATE OR REPLACE FUNCTION public.get_admin_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_et timestamptz;v_wk timestamptz;v_c campaigns%ROWTYPE;v_ft jsonb;v_fw jsonb;v_fa jsonb;v_er jsonb;v_al jsonb[]:=ARRAY[]::jsonb[];v_ag record;v_su jsonb;v_metrics jsonb;
BEGIN
v_et:=date_trunc('day',now() AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York';
v_wk:=now()-interval '7 days';
SELECT * INTO v_c FROM campaigns ORDER BY created_at DESC LIMIT 1;
SELECT jsonb_build_object('calls_attempted',(SELECT count(*) FROM calls WHERE created_at>=v_et AND call_direction='outbound' AND provider_call_id<>''),'live_humans_reached',(SELECT count(*) FROM calls WHERE created_at>=v_et AND is_live_human),'bridge_confirmed',(SELECT count(*) FROM calls WHERE created_at>=v_et AND bridge_confirmed),'total_minutes',round(COALESCE((SELECT sum(duration_seconds) FROM calls WHERE created_at>=v_et),0)::numeric/60,1),'no_answer_count',(SELECT count(*) FROM calls WHERE created_at>=v_et AND queue='no_answer'),'human_drop_count',(SELECT count(*) FROM calls WHERE created_at>=v_et AND queue='human_drop'),'fire_transfer_count',(SELECT count(*) FROM calls WHERE created_at>=v_et AND queue='fire_transfer'),'pending_count',(SELECT count(*) FROM calls WHERE created_at>=v_et AND queue='pending'),'machines_detected',(SELECT count(*) FROM calls WHERE created_at>=v_et AND queue='voice_message'),'transfers_requested',(SELECT count(*) FROM calls WHERE created_at>=v_et AND(queue='fire_transfer' OR transfer_requested_at IS NOT NULL)),'talkroute_answered',(SELECT count(*) FROM calls WHERE created_at>=v_et AND talkroute_answered),'likely_real_conversation',(SELECT count(*) FROM calls WHERE created_at>=v_et AND bridge_confirmed AND duration_seconds>=45),'productive_minutes',round(COALESCE((SELECT sum(duration_seconds) FROM calls WHERE created_at>=v_et AND bridge_confirmed),0)::numeric/60,1),'wasted_minutes',round(COALESCE((SELECT sum(duration_seconds) FROM calls WHERE created_at>=v_et AND(queue IN('no_answer','voice_message') OR NOT is_live_human)),0)::numeric/60,1)) INTO v_ft;
SELECT jsonb_build_object('calls_attempted',(SELECT count(*) FROM calls WHERE created_at>=v_wk AND call_direction='outbound' AND provider_call_id<>''),'live_humans_reached',(SELECT count(*) FROM calls WHERE created_at>=v_wk AND is_live_human),'bridge_confirmed',(SELECT count(*) FROM calls WHERE created_at>=v_wk AND bridge_confirmed),'total_minutes',round(COALESCE((SELECT sum(duration_seconds) FROM calls WHERE created_at>=v_wk),0)::numeric/60,1),'no_answer_count',(SELECT count(*) FROM calls WHERE created_at>=v_wk AND queue='no_answer'),'human_drop_count',(SELECT count(*) FROM calls WHERE created_at>=v_wk AND queue='human_drop'),'fire_transfer_count',(SELECT count(*) FROM calls WHERE created_at>=v_wk AND queue='fire_transfer'),'pending_count',(SELECT count(*) FROM calls WHERE created_at>=v_wk AND queue='pending'),'machines_detected',(SELECT count(*) FROM calls WHERE created_at>=v_wk AND queue='voice_message'),'transfers_requested',(SELECT count(*) FROM calls WHERE created_at>=v_wk AND(queue='fire_transfer' OR transfer_requested_at IS NOT NULL)),'talkroute_answered',(SELECT count(*) FROM calls WHERE created_at>=v_wk AND talkroute_answered),'likely_real_conversation',(SELECT count(*) FROM calls WHERE created_at>=v_wk AND bridge_confirmed AND duration_seconds>=45),'productive_minutes',round(COALESCE((SELECT sum(duration_seconds) FROM calls WHERE created_at>=v_wk AND bridge_confirmed),0)::numeric/60,1),'wasted_minutes',round(COALESCE((SELECT sum(duration_seconds) FROM calls WHERE created_at>=v_wk AND(queue IN('no_answer','voice_message') OR NOT is_live_human)),0)::numeric/60,1)) INTO v_fw;
SELECT jsonb_build_object('calls_attempted',(SELECT count(*) FROM calls WHERE  call_direction='outbound' AND provider_call_id<>''),'live_humans_reached',(SELECT count(*) FROM calls WHERE  is_live_human),'bridge_confirmed',(SELECT count(*) FROM calls WHERE  bridge_confirmed),'total_minutes',round(COALESCE((SELECT sum(duration_seconds) FROM calls ),0)::numeric/60,1),'no_answer_count',(SELECT count(*) FROM calls WHERE  queue='no_answer'),'human_drop_count',(SELECT count(*) FROM calls WHERE  queue='human_drop'),'fire_transfer_count',(SELECT count(*) FROM calls WHERE  queue='fire_transfer'),'pending_count',(SELECT count(*) FROM calls WHERE  queue='pending'),'machines_detected',(SELECT count(*) FROM calls WHERE  queue='voice_message'),'transfers_requested',(SELECT count(*) FROM calls WHERE (queue='fire_transfer' OR transfer_requested_at IS NOT NULL)),'talkroute_answered',(SELECT count(*) FROM calls WHERE  talkroute_answered),'likely_real_conversation',(SELECT count(*) FROM calls WHERE  bridge_confirmed AND duration_seconds>=45),'productive_minutes',round(COALESCE((SELECT sum(duration_seconds) FROM calls WHERE  bridge_confirmed),0)::numeric/60,1),'wasted_minutes',round(COALESCE((SELECT sum(duration_seconds) FROM calls WHERE (queue IN('no_answer','voice_message') OR NOT is_live_human)),0)::numeric/60,1)) INTO v_fa;
SELECT get_recent_errors(20) INTO v_er;
v_su:=jsonb_build_object('campaign_state',COALESCE(v_c.state,'idle'),'dialer_activated',COALESCE(v_c.dialer_activated,false),'concurrency',COALESCE(v_c.concurrency,1),'provider_call_limit',COALESCE(v_c.provider_call_limit,100),'daily_call_limit',v_c.daily_call_target,'daily_minute_cap',v_c.daily_minute_cap,'daily_minutes_used',(v_ft->>'total_minutes')::numeric,'leads_remaining',(SELECT count(*) FROM leads WHERE status='new'),'calls_attempted_today',(v_ft->>'calls_attempted')::int,'live_humans_today',(v_ft->>'live_humans_reached')::int,'human_drops_today',(v_ft->>'human_drop_count')::int,'currently_pending',(v_ft->>'pending_count')::int,'active_agent_count',(SELECT count(*) FROM agents WHERE status='active' AND NOT is_owner),'logged_in_count',(SELECT count(DISTINCT agent_id) FROM auth_sessions WHERE expires_at>now()),'currently_receiving',(SELECT count(*) FROM agents WHERE status='active' AND NOT is_owner AND available_for_transfer));
FOR v_ag IN SELECT id,full_name,role,status,available_for_transfer,active_for_dialer,dialer_concurrency,bland_number,talkroute_number,is_owner,agent_direct_number,transfer_certified,inbound_configured,provider_sync_status,mapping_verified FROM agents WHERE status='active' ORDER BY is_owner DESC,full_name
LOOP
SELECT jsonb_build_object('outbound_attempts_today',count(*) FILTER (WHERE c.created_at>=v_et AND true),
'live_humans',count(*) FILTER (WHERE c.created_at>=v_et AND c.is_live_human),
'human_drops',count(*) FILTER (WHERE c.created_at>=v_et AND c.queue='human_drop'),
'fire_transfers',count(*) FILTER (WHERE c.created_at>=v_et AND c.queue='fire_transfer'),
'no_answers',count(*) FILTER (WHERE c.created_at>=v_et AND c.queue='no_answer'),
'voice_messages',count(*) FILTER (WHERE c.created_at>=v_et AND c.queue='voice_message'),
'transfers_requested_today',count(*) FILTER (WHERE c.created_at>=v_et AND c.transfer_requested_at is not null),
'talkroute_leg_created_today',count(*) FILTER (WHERE c.created_at>=v_et AND c.talkroute_leg_created),
'talkroute_answered_today',count(*) FILTER (WHERE c.created_at>=v_et AND c.talkroute_answered),
'bridge_confirmed_today',count(*) FILTER (WHERE c.created_at>=v_et AND c.bridge_confirmed),
'outbound_attempts_week',count(*) FILTER (WHERE c.created_at>=v_wk AND true),
'live_humans_week',count(*) FILTER (WHERE c.created_at>=v_wk AND c.is_live_human),
'human_drops_week',count(*) FILTER (WHERE c.created_at>=v_wk AND c.queue='human_drop'),
'fire_transfers_week',count(*) FILTER (WHERE c.created_at>=v_wk AND c.queue='fire_transfer'),
'no_answers_week',count(*) FILTER (WHERE c.created_at>=v_wk AND c.queue='no_answer'),
'voice_messages_week',count(*) FILTER (WHERE c.created_at>=v_wk AND c.queue='voice_message'),
'transfers_requested_week',count(*) FILTER (WHERE c.created_at>=v_wk AND c.transfer_requested_at is not null),
'talkroute_leg_created_week',count(*) FILTER (WHERE c.created_at>=v_wk AND c.talkroute_leg_created),
'talkroute_answered_week',count(*) FILTER (WHERE c.created_at>=v_wk AND c.talkroute_answered),
'bridge_confirmed_week',count(*) FILTER (WHERE c.created_at>=v_wk AND c.bridge_confirmed),
'outbound_attempts_all',count(*) FILTER (WHERE true AND true),
'live_humans_all',count(*) FILTER (WHERE true AND c.is_live_human),
'human_drops_all',count(*) FILTER (WHERE true AND c.queue='human_drop'),
'fire_transfers_all',count(*) FILTER (WHERE true AND c.queue='fire_transfer'),
'no_answers_all',count(*) FILTER (WHERE true AND c.queue='no_answer'),
'voice_messages_all',count(*) FILTER (WHERE true AND c.queue='voice_message'),
'transfers_requested_all',count(*) FILTER (WHERE true AND c.transfer_requested_at is not null),
'talkroute_leg_created_all',count(*) FILTER (WHERE true AND c.talkroute_leg_created),
'talkroute_answered_all',count(*) FILTER (WHERE true AND c.talkroute_answered),
'bridge_confirmed_all',count(*) FILTER (WHERE true AND c.bridge_confirmed),
'pending_calls',count(*) FILTER (WHERE c.queue='pending' AND NOT c.is_completed),
'last_call_time',max(c.created_at),
'likely_real_conversation_today',count(*) FILTER (WHERE c.created_at>=v_et AND c.bridge_confirmed AND c.duration_seconds>=45),
'total_minutes_today',round(coalesce(sum(c.duration_seconds) FILTER (WHERE c.created_at>=v_et),0)::numeric/60,1),
'productive_minutes_today',round(coalesce(sum(c.duration_seconds) FILTER (WHERE c.created_at>=v_et AND c.bridge_confirmed),0)::numeric/60,1),
'wasted_minutes_today',round(coalesce(sum(c.duration_seconds) FILTER (WHERE c.created_at>=v_et AND NOT c.is_live_human),0)::numeric/60,1)) INTO v_metrics FROM public.calls c WHERE c.agent_id=v_ag.id AND c.call_direction='outbound' AND nullif(c.provider_call_id,'') IS NOT NULL;
v_al:=array_append(v_al,v_metrics || jsonb_build_object('transfer_certified',v_ag.transfer_certified,'inbound_configured',v_ag.inbound_configured,'provider_sync_status',v_ag.provider_sync_status,'mapping_verified',v_ag.mapping_verified,'phone_ready',public.agent_phone_ready(v_ag.id),'currently_receiving',public.agent_phone_ready(v_ag.id) AND v_ag.available_for_transfer,'id',v_ag.id,'full_name',v_ag.full_name,'role',v_ag.role,'status',v_ag.status,'available_for_transfer',v_ag.available_for_transfer,'active_for_dialer',v_ag.active_for_dialer,'dialer_concurrency',v_ag.dialer_concurrency,'bland_number',v_ag.bland_number,'talkroute_number',v_ag.talkroute_number,'is_owner',v_ag.is_owner,'agent_direct_number',v_ag.agent_direct_number,'calls_today',(SELECT count(*) FROM calls c WHERE c.agent_id=v_ag.id AND c.created_at>=v_et AND c.call_direction='outbound'),'humans_today',(SELECT count(*) FROM calls c WHERE c.agent_id=v_ag.id AND c.created_at>=v_et AND c.is_live_human),'transfers_today',(SELECT count(*) FROM calls c WHERE c.agent_id=v_ag.id AND c.created_at>=v_et AND c.bridge_confirmed),'calls_all_time',(SELECT count(*) FROM calls c WHERE c.agent_id=v_ag.id AND c.call_direction='outbound'),'transfers_all_time',(SELECT count(*) FROM calls c WHERE c.agent_id=v_ag.id AND c.bridge_confirmed)));
END LOOP;
v_su:=v_su||jsonb_build_object('blocking_reason',v_c.blocking_reason,'dialer_status',v_c.dialer_status,'currently_receiving',public.count_available_agents());
RETURN jsonb_build_object('summary',v_su,'funnel_today',v_ft,'funnel_week',v_fw,'funnel_all',v_fa,'errors',v_er,'agents',to_jsonb(v_al));
END;$function$;
