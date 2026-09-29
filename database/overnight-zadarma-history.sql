CREATE OR REPLACE FUNCTION public.record_zadarma_call_event(p_event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
 direction=CASE WHEN left(v_id,4)='out_' OR v_type IN ('NOTIFY_OUT_START','NOTIFY_OUT_END') THEN 'outbound'
 WHEN v_type='PBX_STATISTICS' AND p_event->>'direction'='inbound' THEN 'inbound' ELSE direction END,
 extension=coalesce(nullif(p_event->>'extension',''),extension),
 ringing_at=CASE WHEN v_type IN ('NOTIFY_START','NOTIFY_INTERNAL') THEN coalesce(ringing_at,now()) ELSE ringing_at END,
 answered_at=CASE WHEN voicemail_reached OR v_is_vm THEN NULL WHEN v_type='PBX_STATISTICS' THEN answered_at WHEN v_is_answer THEN coalesce(answered_at,now()) ELSE answered_at END,
 ended_at=CASE WHEN v_is_end THEN coalesce((p_event->>'ended_at')::timestamptz,ended_at,now()) ELSE ended_at END,
 voicemail_reached=voicemail_reached OR v_is_vm,
 disposition=CASE WHEN voicemail_reached OR v_is_vm THEN 'voicemail' WHEN answered_at IS NOT NULL OR v_is_answer THEN 'answered' WHEN v_is_end THEN CASE WHEN p_event->>'disposition'='answered' THEN 'unconfirmed' ELSE coalesce(nullif(p_event->>'disposition',''),'ended') END ELSE disposition END,
 duration_seconds=greatest(duration_seconds,least(86400,greatest(0,coalesce((p_event->>'duration_seconds')::integer,0)))),
 recording_id=coalesce(nullif(p_event->>'recording_id',''),recording_id),
 updated_at=now()
 WHERE pbx_call_id=v_id RETURNING * INTO v_call;
 IF v_call.direction='inbound' AND v_call.ended_at IS NOT NULL AND v_call.answered_at IS NULL AND v_call.disposition<>'answered' THEN
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
 RETURN jsonb_build_object('ok',true,'pbx_call_id',v_id,'voicemail_reached',v_call.voicemail_reached,'agent_answered',(v_call.answered_at IS NOT NULL OR v_call.disposition='answered'));
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_verified_zadarma_call_history(p_stats jsonb,p_start timestamptz,p_end timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,extensions AS $history$
DECLARE
 v_stats jsonb:=p_stats;v_group record;v_agent agents%ROWTYPE;
 v_out boolean;v_vm boolean;v_answer boolean;v_start timestamptz;v_end timestamptz;v_record text;v_caller text;v_duration int;v_count int:=0;
BEGIN
 IF jsonb_typeof(p_stats)<>'array' OR jsonb_array_length(p_stats)>3000 THEN RAISE EXCEPTION 'Invalid history payload';END IF;
 IF p_start IS NULL OR p_end IS NULL OR p_start>=p_end OR p_end-p_start>interval '24 hours'
 OR p_end>now()+interval '1 minute' OR p_start<now()-interval '7 days' THEN RAISE EXCEPTION 'Invalid history window';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('federal-one-zadarma-history-apply',419));
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

 INSERT INTO system_config(key,value)VALUES
 ('zadarma_history_reconciled_at',now()::text),
 ('zadarma_history_last_attempt_at',now()::text),
 ('zadarma_history_last_error',''),
 ('zadarma_history_window_start',p_start::text),
 ('zadarma_history_window_end',p_end::text)
 ON CONFLICT(key) DO UPDATE SET value=excluded.value;
 RETURN jsonb_build_object('ok',true,'calls_checked',v_count);
END;$history$;
REVOKE ALL ON FUNCTION public.apply_verified_zadarma_call_history(jsonb,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_verified_zadarma_call_history(jsonb,timestamptz,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.queue_zadarma_history_reconciliation(p_start timestamptz DEFAULT now()-interval '2 hours',p_end timestamptz DEFAULT now(),p_dry_run boolean DEFAULT false)
RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,extensions AS $queue$
DECLARE v_secret text;v_public_token text;v_timestamp text:=floor(extract(epoch FROM clock_timestamp()))::bigint::text;v_body jsonb;v_request bigint;
BEGIN
 IF p_start IS NULL OR p_end IS NULL OR p_start>=p_end OR p_end-p_start>interval '24 hours'
 OR p_end>now()+interval '1 minute' OR p_start<now()-interval '7 days' THEN RAISE EXCEPTION 'Invalid history window';END IF;
 SELECT value INTO v_secret FROM system_config WHERE key='dialer_scheduler_secret';
 SELECT value INTO v_public_token FROM system_config WHERE key='dialer_scheduler_public_jwt';
 IF length(coalesce(v_secret,''))<32 OR coalesce(v_public_token,'') NOT LIKE 'eyJ%' THEN RAISE EXCEPTION 'History scheduler authentication unavailable';END IF;
 v_body:=jsonb_build_object('start',p_start,'end',p_end,'dry_run',p_dry_run);
 SELECT net.http_post(
 url:='https://rqvpthnackbulnywwgix.supabase.co/functions/v1/zadarma-history',body:=v_body,
 headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_public_token,
 'x-history-timestamp',v_timestamp,
 'x-history-signature',encode(extensions.hmac(convert_to('zadarma-history.'||v_timestamp||'.'||v_body::text,'UTF8'),convert_to(v_secret,'UTF8'),'sha256'),'hex')),
 timeout_milliseconds:=55000) INTO v_request;
 RETURN v_request;
END;$queue$;
REVOKE ALL ON FUNCTION public.queue_zadarma_history_reconciliation(timestamptz,timestamptz,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.queue_zadarma_history_reconciliation(timestamptz,timestamptz,boolean) TO service_role;

