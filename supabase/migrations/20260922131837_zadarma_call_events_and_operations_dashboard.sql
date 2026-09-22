CREATE TABLE public.federal_one_zadarma_calls (
 pbx_call_id text PRIMARY KEY,
 agent_id uuid NOT NULL REFERENCES public.agents(id),
 bland_call_id uuid REFERENCES public.calls(id),
 direction text NOT NULL CHECK(direction IN ('inbound','outbound')),
 caller_number text NOT NULL DEFAULT '',
 called_number text NOT NULL DEFAULT '',
 extension text NOT NULL DEFAULT '',
 started_at timestamptz NOT NULL DEFAULT now(),
 ringing_at timestamptz,
 answered_at timestamptz,
 ended_at timestamptz,
 voicemail_reached boolean NOT NULL DEFAULT false,
 disposition text NOT NULL DEFAULT 'ringing',
 duration_seconds integer NOT NULL DEFAULT 0 CHECK(duration_seconds>=0),
 recording_id text,
 acknowledged_at timestamptz,
 inbox_id uuid REFERENCES public.agent_inbox(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX federal_one_zadarma_calls_agent_time ON public.federal_one_zadarma_calls(agent_id,started_at DESC);
CREATE INDEX federal_one_zadarma_calls_time ON public.federal_one_zadarma_calls(started_at DESC);
CREATE TABLE public.federal_one_zadarma_events (
 event_key text PRIMARY KEY,
 pbx_call_id text NOT NULL,
 agent_id uuid REFERENCES public.agents(id),
 event_type text NOT NULL,
 extension text NOT NULL DEFAULT '',
 disposition text NOT NULL DEFAULT '',
 received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX federal_one_zadarma_events_call ON public.federal_one_zadarma_events(pbx_call_id);
ALTER TABLE public.federal_one_zadarma_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.federal_one_zadarma_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.federal_one_zadarma_calls,public.federal_one_zadarma_events FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.federal_one_zadarma_calls,public.federal_one_zadarma_events TO service_role;
CREATE POLICY zadarma_calls_service ON public.federal_one_zadarma_calls FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY zadarma_events_service ON public.federal_one_zadarma_events FOR ALL TO service_role USING(true) WITH CHECK(true);

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
 ringing_at=CASE WHEN v_type IN ('NOTIFY_START','NOTIFY_INTERNAL') THEN coalesce(ringing_at,now()) ELSE ringing_at END,
 answered_at=CASE WHEN v_is_answer AND NOT v_is_vm THEN coalesce(answered_at,now()) ELSE answered_at END,
 ended_at=CASE WHEN v_is_end THEN coalesce(ended_at,now()) ELSE ended_at END,
 voicemail_reached=voicemail_reached OR v_is_vm,
 disposition=CASE WHEN voicemail_reached OR v_is_vm THEN 'voicemail' WHEN answered_at IS NOT NULL OR v_is_answer THEN 'answered' WHEN v_is_end THEN coalesce(nullif(p_event->>'disposition',''),'ended') ELSE disposition END,
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

CREATE OR REPLACE FUNCTION public.sync_requested_transfer_alert()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_alert uuid; v_stage text;
BEGIN
 IF NEW.agent_id IS NULL OR NEW.transfer_requested_at IS NULL THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.id::text,418));
 v_stage:=CASE WHEN NEW.bridge_confirmed THEN 'bridge_confirmed' WHEN NEW.talkroute_answered THEN 'agent_answered' WHEN NEW.talkroute_leg_created THEN 'destination_dialed' ELSE 'requested' END;
 SELECT id INTO v_alert FROM transfer_alerts WHERE call_id=NEW.id AND agent_id=NEW.agent_id LIMIT 1;
 IF v_alert IS NULL THEN
  INSERT INTO transfer_alerts(agent_id,call_id,lead_id,consumer_name,consumer_phone,consumer_address,call_direction,transfer_reason,transfer_status,recording_url,transcript,created_at)
  VALUES(NEW.agent_id,NEW.id,NEW.lead_id,coalesce(NEW.consumer_name,''),coalesce(NEW.consumer_phone,''),coalesce(NEW.consumer_address,''),coalesce(NEW.call_direction,'outbound'),'Elizabeth requested a transfer to your Zadarma line',v_stage,NEW.recording_url,NEW.transcript,NEW.transfer_requested_at) RETURNING id INTO v_alert;
 END IF;
 UPDATE transfer_alerts SET transfer_status=v_stage,
 recording_url=coalesce(nullif(NEW.recording_url,''),recording_url),transcript=coalesce(nullif(NEW.transcript,''),transcript),
 agent_outcome=CASE WHEN NEW.is_completed AND NOT coalesce(NEW.bridge_confirmed,false) AND agent_outcome IS NULL THEN 'callback_needed' ELSE agent_outcome END,updated_at=now()
 WHERE id=v_alert;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_requested_transfer_alert() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS sync_requested_transfer_alert ON public.calls;
CREATE TRIGGER sync_requested_transfer_alert AFTER INSERT OR UPDATE OF transfer_requested_at,bridge_confirmed,talkroute_answered,talkroute_leg_created,is_completed,recording_url,transcript ON public.calls
FOR EACH ROW EXECUTE FUNCTION public.sync_requested_transfer_alert();

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
  'zadarma',(SELECT jsonb_build_object('incoming',count(*)FILTER(WHERE direction='inbound'),'outgoing',count(*)FILTER(WHERE direction='outbound'),'answered',count(*)FILTER(WHERE direction='inbound'AND answered_at IS NOT NULL),'voicemail_reached',count(*)FILTER(WHERE voicemail_reached),'missed',count(*)FILTER(WHERE direction='inbound'AND ended_at IS NOT NULL AND answered_at IS NULL AND NOT voicemail_reached),'ringing',count(*)FILTER(WHERE direction='inbound'AND ended_at IS NULL AND answered_at IS NULL AND updated_at>now()-interval '5 minutes'))FROM native),
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


