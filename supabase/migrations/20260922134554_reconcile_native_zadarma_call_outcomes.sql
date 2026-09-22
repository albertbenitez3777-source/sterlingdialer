CREATE OR REPLACE FUNCTION public.record_zadarma_call_event(p_event jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE
 v_agent uuid:=(p_event->>'agent_id')::uuid;
 v_id text:=p_event->>'pbx_call_id';
 v_type text:=p_event->>'event_type';
 v_call public.federal_one_zadarma_calls%ROWTYPE;
 v_inbox uuid;
 v_inserted integer;
 v_is_vm boolean:=coalesce((p_event->>'voicemail_reached')::boolean,false);
 v_is_answer boolean:=coalesce((p_event->>'agent_answered')::boolean,false);
 v_is_end boolean:=v_type IN ('NOTIFY_END','NOTIFY_OUT_END','PBX_STATISTICS');
 v_started timestamptz:=coalesce((p_event->>'started_at')::timestamptz,now());
 v_link uuid;
BEGIN
 IF length(v_id) NOT BETWEEN 4 AND 200 OR NOT EXISTS(SELECT 1 FROM agents WHERE id=v_agent AND NOT is_owner) THEN
  RAISE EXCEPTION 'Invalid agent call event';
 END IF;
 INSERT INTO federal_one_zadarma_events(event_key,pbx_call_id,agent_id,event_type,extension,disposition)
 VALUES(p_event->>'event_key',v_id,v_agent,v_type,coalesce(p_event->>'extension',''),coalesce(p_event->>'disposition',''))
 ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS v_inserted=ROW_COUNT;
 IF v_inserted=0 THEN RETURN jsonb_build_object('ok',true,'duplicate',true); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_id,419));
 SELECT c.id INTO v_link FROM calls c WHERE c.agent_id=v_agent
 AND public.normalize_phone(c.consumer_phone)=public.normalize_phone(p_event->>'caller_number')
 AND c.transfer_requested_at BETWEEN v_started-interval '10 minutes' AND v_started+interval '2 minutes'
 ORDER BY abs(extract(epoch FROM c.transfer_requested_at-v_started)) LIMIT 1;
 INSERT INTO federal_one_zadarma_calls(pbx_call_id,agent_id,bland_call_id,direction,caller_number,called_number,extension,started_at)
 VALUES(v_id,v_agent,v_link,coalesce(p_event->>'direction','inbound'),coalesce(p_event->>'caller_number',''),coalesce(p_event->>'called_number',''),coalesce(p_event->>'extension',''),v_started)
 ON CONFLICT(pbx_call_id) DO NOTHING;
 SELECT * INTO v_call FROM federal_one_zadarma_calls WHERE pbx_call_id=v_id FOR UPDATE;
 IF v_call.agent_id<>v_agent THEN RAISE EXCEPTION 'Call route mismatch'; END IF;
 UPDATE federal_one_zadarma_calls SET
 bland_call_id=coalesce(bland_call_id,v_link),
 extension=coalesce(nullif(p_event->>'extension',''),extension),
 ringing_at=CASE WHEN v_type IN ('NOTIFY_START','NOTIFY_INTERNAL') THEN coalesce(ringing_at,now()) ELSE ringing_at END,
 answered_at=CASE WHEN v_is_answer AND NOT v_is_vm THEN coalesce(answered_at,now()) ELSE answered_at END,
 ended_at=CASE WHEN v_is_end THEN coalesce((p_event->>'ended_at')::timestamptz,ended_at,now()) ELSE ended_at END,
 voicemail_reached=voicemail_reached OR v_is_vm,
 disposition=CASE WHEN voicemail_reached OR v_is_vm THEN 'voicemail' WHEN answered_at IS NOT NULL OR v_is_answer THEN 'answered' WHEN v_is_end THEN CASE WHEN p_event->>'disposition'='answered' THEN 'unconfirmed' ELSE coalesce(nullif(p_event->>'disposition',''),'ended') END ELSE disposition END,
 duration_seconds=greatest(duration_seconds,least(86400,greatest(0,coalesce((p_event->>'duration_seconds')::integer,0)))),
 recording_id=coalesce(nullif(p_event->>'recording_id',''),recording_id),
 updated_at=now()
 WHERE pbx_call_id=v_id RETURNING * INTO v_call;
 IF v_call.direction='inbound' AND v_call.ended_at IS NOT NULL AND v_call.answered_at IS NULL THEN
  IF v_call.inbox_id IS NULL THEN
   INSERT INTO agent_inbox(agent_id,call_id,type,title,body,consumer_phone)
   VALUES(v_agent,v_call.bland_call_id,'callback',CASE WHEN v_call.voicemail_reached THEN 'Call reached your voicemail' ELSE 'Missed call on your Zadarma line' END,
    CASE WHEN v_call.voicemail_reached THEN 'Your voicemail service answered this call. A saved message is shown in Voicemail only after its recording is received.' ELSE 'Your assigned line received a call that was not answered. Review the caller and call back.' END,v_call.caller_number)
   RETURNING id INTO v_inbox;
   UPDATE federal_one_zadarma_calls SET inbox_id=v_inbox WHERE pbx_call_id=v_id;
  ELSE
   UPDATE agent_inbox SET title=CASE WHEN v_call.voicemail_reached THEN 'Call reached your voicemail' ELSE 'Missed call on your Zadarma line' END,
    body=CASE WHEN v_call.voicemail_reached THEN 'Your voicemail service answered this call. A saved message is shown in Voicemail only after its recording is received.' ELSE 'Your assigned line received a call that was not answered. Review the caller and call back.' END
   WHERE id=v_call.inbox_id;
  END IF;
 END IF;
 RETURN jsonb_build_object('ok',true,'pbx_call_id',v_id,'voicemail_reached',v_call.voicemail_reached,'agent_answered',v_call.answered_at IS NOT NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.record_zadarma_call_event(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_zadarma_call_event(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.get_operations_overview(p_agent_id uuid DEFAULT NULL,p_window text DEFAULT 'today')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
DECLARE v_since timestamptz; v_result jsonb;
BEGIN
 IF p_window NOT IN ('today','week','all') THEN RAISE EXCEPTION 'Invalid time range'; END IF;
 v_since:=CASE p_window WHEN 'today' THEN date_trunc('day',now() AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York' WHEN 'week' THEN date_trunc('week',now() AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York' ELSE '-infinity'::timestamptz END;
 WITH scoped AS MATERIALIZED (
  SELECT c.* FROM calls c WHERE c.created_at>=v_since AND (p_agent_id IS NULL OR c.agent_id=p_agent_id)
  AND nullif(c.provider_call_id,'') IS NOT NULL
 ), native AS MATERIALIZED (
  SELECT * FROM federal_one_zadarma_calls WHERE started_at>=v_since AND(p_agent_id IS NULL OR agent_id=p_agent_id)
 ), per_agent AS (
  SELECT a.id,a.full_name,public.agent_phone_ready(a.id)AS phone_ready,public.agent_dialer_route_ready(a.id)AS route_ready,
  a.bland_number,a.talkroute_number AS zadarma_number,
  (SELECT count(*)FROM scoped c WHERE c.agent_id=a.id AND c.call_direction='outbound')AS attempts,
  (SELECT count(*)FROM scoped c WHERE c.agent_id=a.id AND c.is_live_human)AS humans,
  (SELECT count(*)FROM scoped c WHERE c.agent_id=a.id AND c.transfer_requested_at IS NOT NULL)AS transfers,
  (SELECT count(*)FROM scoped c WHERE c.agent_id=a.id AND NOT c.is_completed)AS in_progress,
  (SELECT count(*)FROM native n WHERE n.agent_id=a.id AND n.direction='inbound')AS incoming,
  (SELECT count(*)FROM native n WHERE n.agent_id=a.id AND n.direction='inbound' AND n.answered_at IS NOT NULL)AS answered,
  (SELECT count(*)FROM native n WHERE n.agent_id=a.id AND n.voicemail_reached)AS voicemail_reached,
  (SELECT count(*)FROM federal_one_voicemails v WHERE v.agent_id=a.id AND v.received_at>=v_since)AS messages,
  (SELECT count(*)FROM federal_one_voicemails v WHERE v.agent_id=a.id AND v.heard_at IS NULL)AS unheard,
  (SELECT count(*)FROM transfer_alerts t WHERE t.agent_id=a.id AND t.created_at>=v_since AND t.agent_outcome='callback_needed' AND NOT coalesce(t.callback_completed,false))AS callbacks
  FROM agents a WHERE a.status='active' AND NOT a.is_owner AND(p_agent_id IS NULL OR a.id=p_agent_id)
 ), hourly AS (
  SELECT date_trunc('hour',created_at)AS hour,count(*)FILTER(WHERE call_direction='outbound')AS attempts,count(*)FILTER(WHERE is_live_human)AS humans,count(*)FILTER(WHERE transfer_requested_at IS NOT NULL)AS transfers
  FROM scoped WHERE created_at>=greatest(v_since,now()-interval '24 hours') GROUP BY 1 ORDER BY 1
 ) SELECT jsonb_build_object(
  'as_of',now(),'window',p_window,'timezone','America/New_York',
  'campaign',(SELECT jsonb_build_object('state',state,'call_limit',provider_call_limit,'concurrency',concurrency,'started_at',started_at,'accepted',(SELECT count(*)FROM calls c WHERE c.created_at>=campaigns.started_at AND nullif(c.provider_call_id,'')IS NOT NULL AND c.call_direction='outbound'))FROM campaigns ORDER BY created_at DESC LIMIT 1),
  'bland',(SELECT jsonb_build_object('attempts',count(*)FILTER(WHERE call_direction='outbound'),'humans',count(*)FILTER(WHERE is_live_human),'transfers',count(*)FILTER(WHERE transfer_requested_at IS NOT NULL),'destination_dialed',count(*)FILTER(WHERE talkroute_leg_created),'bridge_confirmed',count(*)FILTER(WHERE bridge_confirmed),'in_progress',count(*)FILTER(WHERE NOT is_completed),'no_answer',count(*)FILTER(WHERE queue='no_answer'),'customer_voicemail',count(*)FILTER(WHERE queue='voice_message'),'failures',count(*)FILTER(WHERE transfer_state='transfer_failed'),'minutes',round(coalesce(sum(duration_seconds),0)::numeric/60,1))FROM scoped),
  'zadarma',(SELECT jsonb_build_object('incoming',count(*)FILTER(WHERE direction='inbound'),'outgoing',count(*)FILTER(WHERE direction='outbound'),'answered',count(*)FILTER(WHERE direction='inbound'AND answered_at IS NOT NULL),'voicemail_reached',count(*)FILTER(WHERE voicemail_reached),'missed',count(*)FILTER(WHERE direction='inbound'AND ended_at IS NOT NULL AND answered_at IS NULL AND NOT voicemail_reached AND disposition<>'unconfirmed'),'unconfirmed',count(*)FILTER(WHERE ended_at IS NOT NULL AND answered_at IS NULL AND NOT voicemail_reached AND disposition='unconfirmed'),'ringing',count(*)FILTER(WHERE direction='inbound'AND ended_at IS NULL AND answered_at IS NULL AND updated_at>now()-interval '5 minutes'))FROM native),
  'voicemail',(SELECT jsonb_build_object('messages',count(*),'unheard',count(*)FILTER(WHERE heard_at IS NULL))FROM federal_one_voicemails WHERE received_at>=v_since AND(p_agent_id IS NULL OR agent_id=p_agent_id)),
  'agents',coalesce((SELECT jsonb_agg(to_jsonb(p)ORDER BY full_name)FROM per_agent p),'[]'::jsonb),
  'hourly',coalesce((SELECT jsonb_agg(to_jsonb(h)ORDER BY hour)FROM hourly h),'[]'::jsonb),
  'recent_calls',coalesce((SELECT jsonb_agg(to_jsonb(r))FROM(SELECT n.pbx_call_id,a.full_name,n.direction,n.caller_number,n.called_number,n.started_at,n.disposition,n.voicemail_reached,(n.answered_at IS NOT NULL)AS answered,n.duration_seconds,(n.recording_id IS NOT NULL)AS recording_available FROM native n JOIN agents a ON a.id=n.agent_id ORDER BY n.started_at DESC LIMIT 12)r),'[]'::jsonb),
  'events_enabled',coalesce((SELECT value='true'FROM system_config WHERE key='zadarma_call_events_configured'),false),
  'events_since',(SELECT value FROM system_config WHERE key='zadarma_call_events_since')
 ) INTO v_result;
 RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_operations_overview(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_operations_overview(uuid,text) TO service_role;
CREATE OR REPLACE FUNCTION public.reconcile_zadarma_call_history()
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,extensions AS $$
DECLARE
 v_key text;v_secret text;v_path text:='/v1/statistics/pbx/';v_qs text;v_auth text;
 v_response extensions.http_response;v_stats jsonb;v_group record;v_agent agents%ROWTYPE;
 v_out boolean;v_vm boolean;v_answer boolean;v_start timestamptz;v_end timestamptz;v_record text;v_caller text;v_duration int;v_count int:=0;
BEGIN
 SELECT max(value)FILTER(WHERE key='zadarma_api_key'),max(value)FILTER(WHERE key='zadarma_api_secret') INTO v_key,v_secret FROM system_config;
 IF v_key IS NULL OR v_secret IS NULL THEN RAISE EXCEPTION 'Zadarma configuration is unavailable'; END IF;
 -- Account timezone verified from /v1/info/timezone/: UTC-6.
 v_qs:='end='||replace(replace(to_char(now() AT TIME ZONE 'Etc/GMT+6','YYYY-MM-DD HH24:MI:SS'),' ','+'),':','%3A')||'&start='||replace(replace(to_char((now()-interval '2 hours') AT TIME ZONE 'Etc/GMT+6','YYYY-MM-DD HH24:MI:SS'),' ','+'),':','%3A')||'&version=2';
 v_auth:=v_key||':'||encode(convert_to(encode(extensions.hmac(convert_to(v_path||v_qs||md5(v_qs),'UTF8'),convert_to(v_secret,'UTF8'),'sha1'),'hex'),'UTF8'),'base64');
 SELECT * INTO v_response FROM extensions.http(('GET','https://api.zadarma.com'||v_path||'?'||v_qs,ARRAY[extensions.http_header('Authorization',v_auth)],NULL,NULL)::extensions.http_request);
 IF v_response.status<>200 THEN RAISE EXCEPTION 'Zadarma history returned HTTP %',v_response.status; END IF;
 v_stats:=(v_response.content::jsonb)->'stats';
 IF jsonb_typeof(v_stats)<>'array' THEN RAISE EXCEPTION 'Invalid Zadarma history response'; END IF;
 FOR v_group IN SELECT e->>'pbx_call_id' id,jsonb_agg(e) legs FROM jsonb_array_elements(v_stats)e WHERE nullif(e->>'pbx_call_id','')IS NOT NULL GROUP BY 1 LOOP
  v_out:=v_group.id LIKE 'out_%';
  SELECT a.* INTO v_agent FROM agents a WHERE a.status='active' AND NOT a.is_owner AND EXISTS(
   SELECT 1 FROM jsonb_array_elements(v_group.legs)e WHERE
   (NOT v_out AND normalize_phone(a.talkroute_number)=normalize_phone(e->>'destination')) OR
   (v_out AND split_part(a.zadarma_sip_login,'-',2)=e->>'sip')) LIMIT 1;
  IF NOT FOUND THEN CONTINUE; END IF;
  SELECT bool_or(coalesce(e->>'sip','')~*'8500|voice.?mail'),bool_or(e->>'sip'=split_part(v_agent.zadarma_sip_login,'-',2)AND e->>'disposition'='answered'),
   min((e->>'callstart')::timestamp AT TIME ZONE 'Etc/GMT+6'),max(((e->>'callstart')::timestamp AT TIME ZONE 'Etc/GMT+6')+make_interval(secs=>coalesce((e->>'seconds')::int,0))),max(coalesce((e->>'seconds')::int,0))
   INTO v_vm,v_answer,v_start,v_end,v_duration FROM jsonb_array_elements(v_group.legs)e;
  SELECT e->>'call_id' INTO v_record FROM jsonb_array_elements(v_group.legs)e WHERE e->>'is_recorded' IN('true','1') LIMIT 1;
  SELECT substring(e->>'clid' FROM '<([+0-9]+)>') INTO v_caller FROM jsonb_array_elements(v_group.legs)e WHERE e->>'clid' LIKE '%<%>' LIMIT 1;
  PERFORM public.record_zadarma_call_event(jsonb_build_object('event_key','stats_'||md5(v_group.id||v_group.legs::text),'event_type','PBX_STATISTICS','pbx_call_id',v_group.id,'agent_id',v_agent.id,
   'direction',CASE WHEN v_out THEN 'outbound' ELSE 'inbound' END,'caller_number',CASE WHEN v_out THEN v_agent.talkroute_number ELSE coalesce(v_caller,'')END,
   'called_number',CASE WHEN v_out THEN v_group.legs->0->>'destination' ELSE v_agent.talkroute_number END,
   'extension',split_part(v_agent.zadarma_sip_login,'-',2),'started_at',v_start,'ended_at',v_end,
   'voicemail_reached',v_vm,'agent_answered',v_answer,'duration_seconds',v_duration,
   'disposition',CASE WHEN v_vm THEN 'voicemail' WHEN v_answer THEN 'answered' ELSE 'no answer' END,'recording_id',v_record));
  -- A provider recording ID alone is not evidence that an audio file exists.
  IF v_record IS NULL THEN UPDATE federal_one_zadarma_calls SET recording_id=NULL WHERE pbx_call_id=v_group.id AND NOT EXISTS(SELECT 1 FROM federal_one_zadarma_events WHERE pbx_call_id=v_group.id AND event_type='NOTIFY_RECORD');END IF;
  v_count:=v_count+1;
 END LOOP;
 INSERT INTO system_config(key,value)VALUES('zadarma_history_reconciled_at',now()::text)ON CONFLICT(key)DO UPDATE SET value=excluded.value;
 RETURN jsonb_build_object('ok',true,'calls_checked',v_count);
END;
$$;
REVOKE ALL ON FUNCTION public.reconcile_zadarma_call_history() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_zadarma_call_history() TO service_role;
SELECT cron.schedule('federal-one-zadarma-reconcile','*/10 * * * *','SELECT public.reconcile_zadarma_call_history();');


