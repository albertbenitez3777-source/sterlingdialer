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
 extension=coalesce(nullif(p_event->>'extension',''),extension),
 ringing_at=CASE WHEN v_type IN ('NOTIFY_START','NOTIFY_INTERNAL') THEN coalesce(ringing_at,now()) ELSE ringing_at END,
 answered_at=CASE WHEN voicemail_reached OR v_is_vm THEN NULL WHEN v_is_answer THEN coalesce(answered_at,now()) ELSE answered_at END,
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
$function$
;
UPDATE public.federal_one_zadarma_calls SET answered_at=NULL,disposition='voicemail',updated_at=now() WHERE voicemail_reached AND answered_at IS NOT NULL;


