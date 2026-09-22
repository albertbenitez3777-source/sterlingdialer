CREATE OR REPLACE FUNCTION public.get_delivery_metrics(p_since timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT jsonb_build_object(
 'calls_attempted',count(*) FILTER(WHERE call_direction='outbound'),
 'live_humans_reached',count(*) FILTER(WHERE is_live_human),
 'transfers_requested',count(*) FILTER(WHERE transfer_requested_at IS NOT NULL),
 'talkroute_dialed',count(*) FILTER(WHERE talkroute_leg_created),
 'talkroute_answered',count(*) FILTER(WHERE talkroute_answered),
 'agent_answered',count(*) FILTER(WHERE talkroute_answered),
 'bridge_confirmed',count(*) FILTER(WHERE bridge_confirmed),
 'confirmed_transfer_failures',count(*) FILTER(WHERE transfer_state='transfer_failed'),
 'transfer_failed_unverified',count(*) FILTER(WHERE transfer_requested_at IS NOT NULL AND is_completed AND NOT coalesce(bridge_confirmed,false)),
 'machine_minutes',round(coalesce(sum(duration_seconds) FILTER(WHERE queue='voice_message'),0)::numeric/60,1),
 'avg_ai_leg_seconds',round(coalesce(avg(duration_seconds),0)::numeric,1),
 'avg_machine_seconds',round(coalesce(avg(duration_seconds) FILTER(WHERE queue='voice_message'),0)::numeric,1))
 FROM calls WHERE created_at>=p_since AND nullif(provider_call_id,'') IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.get_delivery_metrics(timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_delivery_metrics(timestamptz) TO service_role;
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
v_ft:=v_ft||public.get_delivery_metrics(v_et);
v_fw:=v_fw||public.get_delivery_metrics(v_wk);
v_fa:=v_fa||public.get_delivery_metrics('-infinity'::timestamptz);
v_su:=v_su||jsonb_build_object('funnel_today',v_ft,'funnel_week',v_fw,'funnel_all',v_fa,'calls_attempted_week',v_fw->'calls_attempted','live_humans_week',v_fw->'live_humans_reached','live_humans_all',v_fa->'live_humans_reached','route_ready_count',public.count_available_agents(),'phone_ready_count',(SELECT count(*) FROM agents WHERE status='active' AND NOT is_owner AND public.agent_phone_ready(id)), 'transfers_requested_today',v_ft->'transfers_requested', 'talkroute_dialed_today',v_ft->'talkroute_dialed', 'agent_answered_today',v_ft->'agent_answered', 'bridge_confirmed_today',v_ft->'bridge_confirmed', 'confirmed_transfer_failures_today',v_ft->'confirmed_transfer_failures', 'transfer_failed_unverified_today',v_ft->'transfer_failed_unverified', 'transfers_requested_week',v_fw->'transfers_requested', 'talkroute_dialed_week',v_fw->'talkroute_dialed', 'agent_answered_week',v_fw->'agent_answered', 'bridge_confirmed_week',v_fw->'bridge_confirmed', 'confirmed_transfer_failures_week',v_fw->'confirmed_transfer_failures', 'transfer_failed_unverified_week',v_fw->'transfer_failed_unverified', 'transfers_requested_all',v_fa->'transfers_requested', 'talkroute_dialed_all',v_fa->'talkroute_dialed', 'agent_answered_all',v_fa->'agent_answered', 'bridge_confirmed_all',v_fa->'bridge_confirmed', 'confirmed_transfer_failures_all',v_fa->'confirmed_transfer_failures', 'transfer_failed_unverified_all',v_fa->'transfer_failed_unverified');
RETURN jsonb_build_object('summary',v_su,'funnel_today',v_ft,'funnel_week',v_fw,'funnel_all',v_fa,'errors',v_er,'agents',to_jsonb(v_al));
END;$function$
;
REVOKE ALL ON FUNCTION public.get_admin_stats() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_stats() TO service_role;


