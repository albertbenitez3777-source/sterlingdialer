SET lock_timeout = '3s';
CREATE INDEX IF NOT EXISTS calls_agent_normalized_history_idx ON public.calls
 (agent_id, public.normalize_phone(consumer_phone), created_at DESC, id);
CREATE INDEX IF NOT EXISTS calls_transfer_agent_time_idx ON public.calls
 (agent_id, transfer_requested_at) WHERE transfer_requested_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS federal_one_zadarma_linked_agent_idx ON public.federal_one_zadarma_calls
 (bland_call_id, agent_id) WHERE bland_call_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS federal_one_zadarma_callback_phone_time_idx ON public.federal_one_zadarma_calls
 (agent_id, (right(regexp_replace(called_number,'\D','','g'),10)), started_at);

CREATE OR REPLACE FUNCTION public.get_operations_overview(p_agent_id uuid DEFAULT NULL::uuid, p_window text DEFAULT 'today'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE v_since timestamptz; v_result jsonb;
BEGIN
 IF p_window IS NULL OR p_window NOT IN ('today','week','all') THEN RAISE EXCEPTION 'Invalid time range'; END IF;
 v_since:=CASE p_window WHEN 'today' THEN date_trunc('day',now() AT TIME ZONE 'America/Costa_Rica') AT TIME ZONE 'America/Costa_Rica'
 WHEN 'week' THEN date_trunc('week',now() AT TIME ZONE 'America/Costa_Rica') AT TIME ZONE 'America/Costa_Rica' ELSE '-infinity'::timestamptz END;
 WITH campaign AS MATERIALIZED (SELECT * FROM campaigns ORDER BY created_at DESC LIMIT 1),
 scoped AS MATERIALIZED (
  SELECT c.id,c.agent_id,c.created_at,c.is_live_human,c.transfer_requested_at,c.queue,
  c.is_completed,c.talkroute_leg_created,c.bridge_confirmed,c.transfer_state,c.duration_seconds
  FROM calls c WHERE c.created_at>=v_since AND c.call_direction='outbound'
  AND nullif(c.provider_call_id,'') IS NOT NULL AND(p_agent_id IS NULL OR c.agent_id=p_agent_id)
 ), native AS MATERIALIZED (
  SELECT * FROM federal_one_zadarma_calls WHERE started_at>=v_since AND(p_agent_id IS NULL OR agent_id=p_agent_id)
 ), voicemail AS MATERIALIZED (
  SELECT * FROM federal_one_voicemails WHERE nullif(storage_path,'') IS NOT NULL AND(p_agent_id IS NULL OR agent_id=p_agent_id)
 ), tracked AS MATERIALIZED (
  SELECT agent_id,provider_call_id,created_at FROM calls WHERE call_direction='outbound' AND queue='pending' AND NOT is_completed
 ), eligible AS MATERIALIZED (
  SELECT a.id,least(coalesce(a.dialer_concurrency,3),7) AS capacity,
  (SELECT count(*) FROM calls c WHERE c.agent_id=a.id AND c.queue='pending' AND NOT c.is_completed) AS occupied
  FROM agents a CROSS JOIN campaign cp WHERE campaign_agent_can_receive(a.id,cp.id)
 ), live AS (
  SELECT count(*) FILTER(WHERE nullif(provider_call_id,'') IS NOT NULL) AS active,
  count(*) FILTER(WHERE nullif(provider_call_id,'') IS NULL) AS reserved,
  count(*) FILTER(WHERE nullif(provider_call_id,'') IS NOT NULL AND created_at<now()-interval '10 minutes') AS aged,
  min(created_at) AS oldest_at FROM tracked
 ), pace AS (
  SELECT count(*)::int AS recent_hour,count(*) FILTER(WHERE created_at>=now()-interval '1 minute')::int AS recent_minute
  FROM calls WHERE call_direction='outbound' AND created_at>=now()-interval '1 hour'
 ), per_agent AS (
  SELECT a.id,a.full_name,a.status,a.active_for_dialer AS selected,agent_phone_ready(a.id) AS phone_ready,agent_dialer_route_ready(a.id) AS route_ready,
  a.bland_number,a.talkroute_number AS zadarma_number,
  (SELECT count(*) FROM scoped c WHERE c.agent_id=a.id) AS attempts,
  (SELECT count(*) FROM scoped c WHERE c.agent_id=a.id AND c.is_live_human) AS humans,
  (SELECT count(*) FROM scoped c WHERE c.agent_id=a.id AND c.transfer_requested_at IS NOT NULL) AS transfers,
  (SELECT count(*) FROM tracked c WHERE c.agent_id=a.id AND nullif(c.provider_call_id,'') IS NOT NULL) AS in_progress,
  (SELECT count(*) FROM scoped c WHERE c.agent_id=a.id AND EXISTS(SELECT 1 FROM federal_one_zadarma_calls n WHERE n.bland_call_id=c.id AND n.direction='inbound' AND n.answered_at IS NOT NULL AND NOT coalesce(n.voicemail_reached,false))) AS transfer_answers,
  (SELECT count(*) FROM native n WHERE n.agent_id=a.id AND n.direction='inbound') AS incoming,
  (SELECT count(*) FROM native n WHERE n.agent_id=a.id AND n.direction='inbound' AND n.answered_at IS NOT NULL AND NOT coalesce(n.voicemail_reached,false)) AS answered,
  (SELECT count(*) FROM native n WHERE n.agent_id=a.id AND n.direction='inbound' AND n.voicemail_reached) AS voicemail_reached,
  (SELECT count(*) FROM native n WHERE n.agent_id=a.id AND n.direction='inbound' AND n.ended_at IS NOT NULL AND n.answered_at IS NULL AND NOT coalesce(n.voicemail_reached,false) AND coalesce(n.disposition,'unconfirmed')<>'unconfirmed') AS missed,
  (SELECT count(*) FROM voicemail v WHERE v.agent_id=a.id AND v.received_at>=v_since) AS messages,
  (SELECT count(*) FROM voicemail v WHERE v.agent_id=a.id AND v.received_at>=v_since AND v.heard_at IS NULL) AS unheard,
  (SELECT count(*) FROM voicemail v WHERE v.agent_id=a.id AND v.heard_at IS NULL) AS unheard_backlog,
  (SELECT count(*) FROM transfer_alerts t WHERE t.agent_id=a.id AND t.agent_outcome='callback_needed' AND NOT coalesce(t.callback_completed,false)) AS callbacks
  FROM agents a WHERE NOT a.is_owner AND(p_agent_id IS NULL OR a.id=p_agent_id)
  AND(a.status='active' OR EXISTS(SELECT 1 FROM scoped c WHERE c.agent_id=a.id) OR EXISTS(SELECT 1 FROM native n WHERE n.agent_id=a.id))
 ), hourly AS (
  SELECT h.hour,count(c.id) AS attempts,count(c.id) FILTER(WHERE c.is_live_human) AS humans,count(c.id) FILTER(WHERE c.transfer_requested_at IS NOT NULL) AS transfers
  FROM generate_series(date_trunc('hour',greatest(v_since,now()-interval '23 hours')),date_trunc('hour',now()),interval '1 hour') h(hour)
  LEFT JOIN scoped c ON c.created_at>=h.hour AND c.created_at<h.hour+interval '1 hour' GROUP BY h.hour
 ), outcomes AS (
  SELECT CASE WHEN queue='pending' AND NOT is_completed THEN 'in_progress' WHEN is_live_human THEN 'human'
  WHEN queue='voice_message' THEN 'customer_voicemail' WHEN queue='no_answer' THEN 'no_answer' ELSE 'other' END AS outcome FROM scoped
 )
 SELECT jsonb_build_object(
  'as_of',now(),'window',p_window,'since',CASE WHEN isfinite(v_since) THEN v_since ELSE NULL END,'timezone','America/Costa_Rica',
  'campaign',coalesce((SELECT jsonb_build_object('state',state,'call_limit',provider_call_limit,'concurrency',concurrency,'started_at',started_at,
   'accepted',(SELECT count(*) FROM calls c WHERE c.created_at>=cp.started_at AND nullif(c.provider_call_id,'') IS NOT NULL AND c.call_direction='outbound')) FROM campaign cp),'{}'::jsonb),
  'lines',(SELECT jsonb_build_object('configured',coalesce(cp.concurrency,0),'effective',least(coalesce(cp.concurrency,0),12,coalesce((SELECT sum(capacity) FROM eligible),0)),
   'active',l.active,'reserved',l.reserved,'aged',l.aged,'oldest_at',l.oldest_at,
   'hourly_target',coalesce(cp.hourly_call_target,400),'minute_limit',greatest(ceil(greatest(coalesce(cp.hourly_call_target,400),1)/60.0),least(greatest(coalesce(cp.concurrency,1),1),12)),
   'recent_hour',p.recent_hour,'recent_minute',p.recent_minute,'pacing_allowance',dialer_rate_allowance(cp.hourly_call_target,p.recent_hour,p.recent_minute,cp.concurrency),
   'available_slots',greatest(0,least(coalesce(cp.concurrency,0),12)-l.active-l.reserved),
   'agent_slots',coalesce((SELECT sum(greatest(0,capacity-occupied)) FROM eligible),0),
   'selected_agents',(SELECT count(*) FROM agents WHERE status='active' AND NOT is_owner AND active_for_dialer),
   'eligible_agents',(SELECT count(*) FROM eligible),'blocking_reason',cp.blocking_reason)
   FROM live l CROSS JOIN pace p LEFT JOIN campaign cp ON true),
  'bland',(SELECT jsonb_build_object('attempts',count(*),'humans',count(*) FILTER(WHERE is_live_human),'transfers',count(*) FILTER(WHERE transfer_requested_at IS NOT NULL),
   'destination_dialed',count(*) FILTER(WHERE talkroute_leg_created),'bridge_confirmed',count(*) FILTER(WHERE bridge_confirmed),
   'in_progress',count(*) FILTER(WHERE queue='pending' AND NOT is_completed),'no_answer',count(*) FILTER(WHERE queue='no_answer'),
   'customer_voicemail',count(*) FILTER(WHERE queue='voice_message'),'failures',count(*) FILTER(WHERE transfer_state='transfer_failed'),
   'linked_received',count(*) FILTER(WHERE EXISTS(SELECT 1 FROM federal_one_zadarma_calls n WHERE n.bland_call_id=c.id AND n.direction='inbound')),
   'linked_answered',count(*) FILTER(WHERE EXISTS(SELECT 1 FROM federal_one_zadarma_calls n WHERE n.bland_call_id=c.id AND n.direction='inbound' AND n.answered_at IS NOT NULL AND NOT coalesce(n.voicemail_reached,false))),
   'linked_voicemail',count(*) FILTER(WHERE EXISTS(SELECT 1 FROM federal_one_zadarma_calls n WHERE n.bland_call_id=c.id AND n.direction='inbound' AND n.voicemail_reached)),
   'minutes',round(coalesce(sum(duration_seconds),0)::numeric/60,1)) FROM scoped c),
  'zadarma',(SELECT jsonb_build_object('incoming',count(*) FILTER(WHERE direction='inbound'),'outgoing',count(*) FILTER(WHERE direction='outbound'),
   'answered',count(*) FILTER(WHERE direction='inbound' AND answered_at IS NOT NULL AND NOT coalesce(voicemail_reached,false)),
   'voicemail_reached',count(*) FILTER(WHERE direction='inbound' AND voicemail_reached),
   'missed',count(*) FILTER(WHERE direction='inbound' AND ended_at IS NOT NULL AND answered_at IS NULL AND NOT coalesce(voicemail_reached,false) AND coalesce(disposition,'unconfirmed')<>'unconfirmed'),
   'unconfirmed',count(*) FILTER(WHERE direction='inbound' AND answered_at IS NULL AND NOT coalesce(voicemail_reached,false) AND (ended_at IS NOT NULL AND coalesce(disposition,'unconfirmed')='unconfirmed' OR ended_at IS NULL AND updated_at<=now()-interval '5 minutes')),
   'ringing',count(*) FILTER(WHERE direction='inbound' AND ended_at IS NULL AND answered_at IS NULL AND NOT coalesce(voicemail_reached,false) AND updated_at>now()-interval '5 minutes'),
   'connected',count(*) FILTER(WHERE direction='inbound' AND ended_at IS NULL AND answered_at IS NOT NULL AND NOT coalesce(voicemail_reached,false) AND updated_at>now()-interval '5 minutes'),
   'linked_transfers',count(*) FILTER(WHERE direction='inbound' AND bland_call_id IS NOT NULL),
   'unlinked_incoming',count(*) FILTER(WHERE direction='inbound' AND bland_call_id IS NULL),
   'outgoing_answered',count(*) FILTER(WHERE direction='outbound' AND answered_at IS NOT NULL AND NOT coalesce(voicemail_reached,false))) FROM native),
  'voicemail',(SELECT jsonb_build_object('messages',count(*) FILTER(WHERE received_at>=v_since),'unheard',count(*) FILTER(WHERE received_at>=v_since AND heard_at IS NULL),'unheard_backlog',count(*) FILTER(WHERE heard_at IS NULL)) FROM voicemail),
  'outcomes',(SELECT jsonb_object_agg(outcome,n) FROM(SELECT outcome,count(*) AS n FROM outcomes GROUP BY outcome)o),
  'agents',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY full_name) FROM per_agent p),'[]'::jsonb),
  'hourly',coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY hour) FROM hourly h),'[]'::jsonb),
  'recent_calls',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY started_at DESC) FROM(SELECT n.pbx_call_id,a.full_name,n.direction,n.caller_number,n.called_number,n.started_at,n.disposition,n.voicemail_reached,
   (n.answered_at IS NOT NULL AND NOT coalesce(n.voicemail_reached,false)) AS answered,n.duration_seconds,(nullif(n.recording_id,'') IS NOT NULL) AS recording_available,
   n.bland_call_id IS NOT NULL AS linked_transfer FROM native n LEFT JOIN agents a ON a.id=n.agent_id ORDER BY n.started_at DESC LIMIT 12)r),'[]'::jsonb),
  'events_enabled',coalesce((SELECT value='true' FROM system_config WHERE key='zadarma_call_events_configured'),false),
  'events_since',(SELECT value FROM system_config WHERE key='zadarma_call_events_since'),
  'last_event_at',(SELECT max(received_at) FROM federal_one_zadarma_events WHERE p_agent_id IS NULL OR agent_id=p_agent_id),
  'dialer_runtime',public.get_dialer_runtime()
 ) INTO v_result;
 RETURN v_result;
END;
$function$

