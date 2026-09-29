-- Reporting only: provider history answers are evidence, not fabricated pickup timestamps.
SET lock_timeout='3s';
CREATE OR REPLACE FUNCTION public.federal_one_monitoring_report(p_day date, p_agent_id uuid DEFAULT NULL::uuid, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
DECLARE result jsonb; BEGIN
 EXECUTE $report$WITH bounds AS MATERIALIZED (
 SELECT $1::timestamp AT TIME ZONE 'America/Costa_Rica' AS lo,
 ($1+1)::timestamp AT TIME ZONE 'America/Costa_Rica' AS hi,now() AS clock
), roster AS MATERIALIZED (
 SELECT id,full_name,available_for_transfer FROM public.agents
 WHERE visible_in_admin IS TRUE AND status='active' AND role NOT IN ('owner','administrator')
), event_flags AS MATERIALIZED (
 SELECT e.pbx_call_id,e.agent_id,
 bool_or(e.event_type IN ('NOTIFY_OUT_START','NOTIFY_OUT_END')) AS outbound,
 bool_or(e.event_type='NOTIFY_START') AS inbound
 FROM public.federal_one_zadarma_events e JOIN public.federal_one_zadarma_calls z
 ON z.pbx_call_id=e.pbx_call_id AND z.agent_id=e.agent_id CROSS JOIN bounds b
 WHERE z.started_at>=b.lo AND z.started_at<b.hi GROUP BY 1,2
), call_rows AS MATERIALIZED (
 SELECT z.pbx_call_id,z.agent_id,z.started_at,z.answered_at,z.ended_at,z.disposition,
 z.voicemail_reached,z.duration_seconds AS provider_total_seconds,
 CASE WHEN f.outbound AND NOT coalesce(f.inbound,false) THEN 'outbound'
 WHEN f.inbound AND f.outbound THEN 'unknown'
 WHEN z.direction='outbound' AND NOT coalesce(f.inbound,false) THEN 'outbound'
 WHEN linked.id IS NOT NULL AND (coalesce(f.inbound,false) OR z.direction='inbound') THEN 'transfer'
 WHEN f.inbound THEN 'inbound'
 ELSE z.direction END AS kind,
 CASE WHEN f.outbound AND NOT coalesce(f.inbound,false) OR z.direction='outbound'
 THEN z.called_number ELSE z.caller_number END AS phone,
 CASE WHEN z.answered_at IS NOT NULL AND z.ended_at>=z.answered_at AND NOT coalesce(z.voicemail_reached,false)
 THEN extract(epoch FROM z.ended_at-z.answered_at)::integer ELSE NULL END AS connected_seconds,
 CASE WHEN z.answered_at>=coalesce(z.ringing_at,z.started_at)
 THEN extract(epoch FROM z.answered_at-coalesce(z.ringing_at,z.started_at))::integer ELSE NULL END AS ring_seconds,
 (nullif(z.recording_id,'') IS NOT NULL) AS recording_available
 FROM public.federal_one_zadarma_calls z CROSS JOIN bounds b
 LEFT JOIN event_flags f ON f.pbx_call_id=z.pbx_call_id AND f.agent_id=z.agent_id
 LEFT JOIN LATERAL (SELECT c.id FROM public.calls c WHERE c.id=z.bland_call_id AND c.agent_id=z.agent_id LIMIT 1) linked ON true
 WHERE z.started_at>=b.lo AND z.started_at<b.hi
), assignment_sources AS MATERIALIZED (
 SELECT t.agent_id,coalesce(t.call_id::text,t.id::text) AS source_id,t.consumer_name AS name,t.consumer_phone AS phone,
 t.created_at,t.callback_completed AS completed,'Transfer / callback'::text AS reason
 FROM public.transfer_alerts t CROSS JOIN bounds b LEFT JOIN public.calls c ON c.id=t.call_id
 WHERE t.created_at>=b.lo AND t.created_at<b.hi AND NOT coalesce(c.is_dnc,false) AND NOT coalesce(c.is_wrong_number,false)
 AND (t.callback_at IS NOT NULL OR t.agent_outcome='callback_needed' OR NOT EXISTS(
 SELECT 1 FROM public.federal_one_zadarma_calls z WHERE z.bland_call_id=c.id AND z.agent_id=t.agent_id AND (z.answered_at IS NOT NULL OR z.disposition='answered') AND NOT coalesce(z.voicemail_reached,false)))
 UNION ALL
 SELECT c.agent_id,c.id::text,c.consumer_name,c.consumer_phone,c.created_at,false,'Human / callback opportunity'
 FROM public.calls c CROSS JOIN bounds b
 WHERE c.created_at>=b.lo AND c.created_at<b.hi AND NOT coalesce(c.is_dnc,false) AND NOT coalesce(c.is_wrong_number,false)
 AND (c.callback_requested OR c.is_live_human OR c.queue IN ('human_drop','fire_transfer','voice_message'))
 AND NOT EXISTS(SELECT 1 FROM public.federal_one_zadarma_calls z WHERE z.bland_call_id=c.id AND z.agent_id=c.agent_id AND (z.answered_at IS NOT NULL OR z.disposition='answered') AND NOT coalesce(z.voicemail_reached,false))
 UNION ALL
 SELECT i.agent_id,coalesce(i.call_id::text,i.id::text),i.consumer_name,i.consumer_phone,i.created_at,false,'Inbox callback'
 FROM public.agent_inbox i CROSS JOIN bounds b LEFT JOIN public.calls c ON c.id=i.call_id
 WHERE i.created_at>=b.lo AND i.created_at<b.hi AND i.type='callback' AND NOT i.is_archived
 AND NOT coalesce(c.is_dnc,false) AND NOT coalesce(c.is_wrong_number,false)
), unique_assignments AS MATERIALIZED (
 SELECT DISTINCT ON (agent_id,coalesce(nullif(right(regexp_replace(phone,'\D','','g'),10),''),source_id)) *
 FROM assignment_sources ORDER BY agent_id,coalesce(nullif(right(regexp_replace(phone,'\D','','g'),10),''),source_id),created_at DESC,completed DESC
), assignments AS MATERIALIZED (
 SELECT a.*,d.pbx_call_id AS attempt_id,d.started_at AS attempted_at
 FROM unique_assignments a LEFT JOIN LATERAL (
 SELECT c.pbx_call_id,c.started_at FROM call_rows c WHERE c.agent_id=a.agent_id AND c.kind='outbound'
 AND c.started_at>=a.created_at AND length(regexp_replace(a.phone,'\D','','g'))>=10
 AND right(regexp_replace(c.phone,'\D','','g'),10)=right(regexp_replace(a.phone,'\D','','g'),10)
 ORDER BY c.started_at LIMIT 1) d ON true
), intervals AS MATERIALIZED (
 SELECT i.agent_id,greatest(i.started_at,b.lo) AS started_at,
 least(i.last_seen_at+interval '90 seconds',b.hi,b.clock) AS ended_at,i.last_seen_at
 FROM public.federal_one_monitoring_intervals i CROSS JOIN bounds b
 WHERE i.started_at<b.hi AND i.last_seen_at+interval '90 seconds'>b.lo
), attendance AS MATERIALIZED (
 SELECT agent_id,sum(greatest(0,extract(epoch FROM ended_at-started_at)))::bigint AS seconds,
 max(last_seen_at) AS last_seen_at,
 max(started_at) FILTER (WHERE last_seen_at>now()-interval '90 seconds') AS current_since
 FROM intervals GROUP BY agent_id
), week_bounds AS MATERIALIZED (
 SELECT date_trunc('week',$1::timestamp) AT TIME ZONE 'America/Costa_Rica' AS lo,
 least(($1+1)::timestamp AT TIME ZONE 'America/Costa_Rica',now()) AS hi
), weekly_attendance AS MATERIALIZED (
 SELECT i.agent_id,sum(greatest(0,extract(epoch from least(i.last_seen_at+interval '90 seconds',w.hi)-greatest(i.started_at,w.lo))))::bigint AS seconds
 FROM public.federal_one_monitoring_intervals i CROSS JOIN week_bounds w
 WHERE i.started_at<w.hi AND i.last_seen_at+interval '90 seconds'>w.lo GROUP BY i.agent_id
), live_presence AS MATERIALIZED (
 SELECT a.id AS agent_id,max(s.last_heartbeat_at) AS last_seen_at,
 (SELECT min(i.started_at) FROM public.federal_one_monitoring_intervals i WHERE i.agent_id=a.id AND i.last_seen_at>=now()-interval '90 seconds') AS tracked_since
 FROM roster a LEFT JOIN public.auth_sessions s ON s.agent_id=a.id AND s.invalidated_at IS NULL AND s.expires_at>now()
 GROUP BY a.id
), transfer_backlog_sources AS MATERIALIZED (
 SELECT c.agent_id,c.id::text AS source_id,c.consumer_name AS name,c.consumer_phone AS phone,
 coalesce(c.transfer_requested_at,c.created_at) AS created_at
 FROM public.calls c CROSS JOIN bounds b
 WHERE c.transfer_requested_at IS NOT NULL AND c.transfer_requested_at<least(b.hi,now())
 AND NOT coalesce(c.is_dnc,false) AND NOT coalesce(c.is_wrong_number,false)
 AND EXISTS(SELECT 1 FROM public.federal_one_zadarma_calls z WHERE z.agent_id=c.agent_id AND z.bland_call_id=c.id AND z.direction='inbound')
 AND NOT EXISTS (SELECT 1 FROM public.federal_one_zadarma_calls z WHERE z.agent_id=c.agent_id AND z.bland_call_id=c.id AND (z.answered_at IS NOT NULL OR z.disposition='answered') AND NOT coalesce(z.voicemail_reached,false))
 AND NOT EXISTS (SELECT 1 FROM public.transfer_alerts t WHERE t.call_id=c.id AND t.agent_id=c.agent_id AND (t.callback_completed OR t.is_dismissed))
 UNION ALL
 SELECT t.agent_id,coalesce(t.call_id::text,t.id::text),t.consumer_name,t.consumer_phone,t.created_at
 FROM public.transfer_alerts t LEFT JOIN public.calls c ON c.id=t.call_id CROSS JOIN bounds b
 WHERE t.created_at<least(b.hi,now()) AND NOT coalesce(t.callback_completed,false) AND NOT coalesce(t.is_dismissed,false)
 AND (t.callback_at IS NOT NULL OR t.agent_outcome='callback_needed')
 AND (t.callback_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.federal_one_zadarma_calls z WHERE z.agent_id=t.agent_id AND z.bland_call_id=c.id AND (z.answered_at IS NOT NULL OR z.disposition='answered') AND NOT coalesce(z.voicemail_reached,false)))
 AND NOT coalesce(c.is_dnc,false) AND NOT coalesce(c.is_wrong_number,false)
 AND EXISTS(SELECT 1 FROM public.federal_one_zadarma_calls z WHERE z.agent_id=c.agent_id AND z.bland_call_id=c.id AND z.direction='inbound')
), transfer_backlog_unique AS MATERIALIZED (
 SELECT DISTINCT ON (agent_id,right(regexp_replace(phone,'\D','','g'),10)) *
 FROM transfer_backlog_sources WHERE length(regexp_replace(phone,'\D','','g'))>=10
 ORDER BY agent_id,right(regexp_replace(phone,'\D','','g'),10),created_at DESC
), transfer_backlog AS MATERIALIZED (
 SELECT t.* FROM transfer_backlog_unique t CROSS JOIN bounds b
 WHERE NOT EXISTS (SELECT 1 FROM public.federal_one_zadarma_calls z WHERE z.agent_id=t.agent_id
 AND z.started_at>=t.created_at AND z.started_at<least(b.hi,now())
 AND right(regexp_replace(z.called_number,'\D','','g'),10)=right(regexp_replace(t.phone,'\D','','g'),10)
 AND (z.direction='outbound' OR EXISTS(SELECT 1 FROM public.federal_one_zadarma_events e WHERE e.pbx_call_id=z.pbx_call_id AND e.agent_id=z.agent_id AND e.event_type IN ('NOTIFY_OUT_START','NOTIFY_OUT_END')))
 AND NOT EXISTS(SELECT 1 FROM public.federal_one_zadarma_events e WHERE e.pbx_call_id=z.pbx_call_id AND e.agent_id=z.agent_id AND e.event_type='NOTIFY_START'))
), summaries AS MATERIALIZED (
 SELECT r.id,r.full_name,
 CASE WHEN coalesce(l.last_seen_at,'epoch'::timestamptz)<now()-interval '90 seconds' AND l.tracked_since IS NULL THEN 'Not reporting' WHEN r.available_for_transfer THEN 'Online' ELSE 'Away' END AS presence,
 l.tracked_since AS current_since,greatest(l.last_seen_at,a.last_seen_at) AS last_seen_at,coalesce(a.seconds,0) AS logged_seconds,
 CASE WHEN l.tracked_since IS NOT NULL THEN extract(epoch from now()-l.tracked_since)::bigint ELSE NULL END AS current_login_seconds,
 coalesce(w.seconds,0) AS week_logged_seconds,
 (SELECT count(*) FROM public.calls c CROSS JOIN bounds b WHERE c.agent_id=r.id AND c.transfer_requested_at>=b.lo AND c.transfer_requested_at<b.hi) AS transfers_sent,
 (SELECT count(*) FROM transfer_backlog t WHERE t.agent_id=r.id) AS transfers_pending_callback,
 (SELECT count(*) FROM call_rows c WHERE c.agent_id=r.id AND c.kind='outbound') AS outbound_calls,
 (SELECT count(*) FROM call_rows c WHERE c.agent_id=r.id AND c.kind='outbound' AND (c.answered_at IS NOT NULL OR c.disposition='answered') AND NOT coalesce(c.voicemail_reached,false)) AS outbound_answered,
 (SELECT count(*) FROM call_rows c WHERE c.agent_id=r.id AND c.kind='inbound' AND (c.answered_at IS NOT NULL OR c.disposition='answered') AND NOT coalesce(c.voicemail_reached,false)) AS inbound_answered,
 (SELECT count(*) FROM call_rows c WHERE c.agent_id=r.id AND c.kind='transfer') AS transfers_received,
 (SELECT count(*) FROM call_rows c WHERE c.agent_id=r.id AND c.kind='transfer' AND (c.answered_at IS NOT NULL OR c.disposition='answered') AND NOT coalesce(c.voicemail_reached,false)) AS transfers_answered,
 (SELECT count(*) FROM call_rows c WHERE c.agent_id=r.id AND coalesce(c.voicemail_reached,false)) AS voicemail_visits,
 (SELECT count(*) FROM call_rows c WHERE c.agent_id=r.id AND c.kind='unknown') AS unknown_direction,
 (SELECT coalesce(sum(connected_seconds),0) FROM call_rows c WHERE c.agent_id=r.id) AS connected_seconds,
 (SELECT round(avg(connected_seconds)) FROM call_rows c WHERE c.agent_id=r.id) AS average_seconds,
 (SELECT count(*) FROM call_rows c WHERE c.agent_id=r.id AND c.connected_seconds<15) AS short_calls,
 (SELECT count(*) FROM assignments x WHERE x.agent_id=r.id) AS callbacks_assigned,
 (SELECT count(*) FROM assignments x WHERE x.agent_id=r.id AND x.attempt_id IS NOT NULL) AS callbacks_attempted,
 (SELECT count(*) FROM assignments x WHERE x.agent_id=r.id AND x.attempt_id IS NULL AND NOT coalesce(x.completed,false)) AS callbacks_pending
 FROM roster r LEFT JOIN attendance a ON a.agent_id=r.id LEFT JOIN weekly_attendance w ON w.agent_id=r.id LEFT JOIN live_presence l ON l.agent_id=r.id
)
SELECT jsonb_build_object('day',$1,'timezone','America/Costa_Rica','server_now',now(),
 'attendance_enabled_at',(SELECT enabled_at FROM public.federal_one_monitoring_config WHERE singleton),
 'agents',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.full_name) FROM summaries s),'[]'::jsonb),
 'transfer_backlog_total',(SELECT count(*) FROM transfer_backlog WHERE agent_id=$2),
 'transfer_backlog',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM transfer_backlog WHERE agent_id=$2 ORDER BY created_at DESC,source_id LIMIT 100 OFFSET greatest(0,$3))x),'[]'::jsonb),
 'calls_total',(SELECT count(*) FROM call_rows WHERE agent_id=$2),
 'calls',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM call_rows WHERE agent_id=$2 ORDER BY started_at DESC,pbx_call_id LIMIT 100 OFFSET greatest(0,$3)) x),'[]'::jsonb),
 'callbacks_total',(SELECT count(*) FROM assignments WHERE agent_id=$2),
 'callbacks',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM assignments WHERE agent_id=$2 ORDER BY created_at DESC,source_id LIMIT 100 OFFSET greatest(0,$3)) x),'[]'::jsonb),
 'intervals',coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY started_at) FROM intervals i WHERE agent_id=$2),'[]'::jsonb))$report$ INTO result USING p_day,p_agent_id,p_offset;
 RETURN result; END;
$function$;

CREATE OR REPLACE FUNCTION public.get_agent_human_callback_queue(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH blocked AS MATERIALIZED (
 SELECT public.normalize_phone(telephone_normalized) phone FROM public.suppression_entries
 UNION
 SELECT public.normalize_phone(consumer_phone) FROM public.calls
 WHERE is_dnc OR is_wrong_number OR lower(coalesce(agent_disposition,'')) IN ('dnc','do_not_call','wrong_number','deceased')
), raw AS MATERIALIZED (
 SELECT c.*,public.normalize_phone(c.consumer_phone) normalized,
 (SELECT string_agg(lower(line),' ') FROM regexp_split_to_table(coalesce(c.transcript,''),E'\n') line WHERE line ~* '^\s*(user|human):') AS caller_speech
 FROM public.calls c WHERE c.agent_id=p_agent_id AND c.call_direction='outbound'
 AND c.is_live_human AND c.is_completed AND nullif(c.provider_call_id,'') IS NOT NULL
), candidate AS MATERIALIZED (
 SELECT r.* FROM raw r WHERE nullif(r.normalized,'') IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM blocked b WHERE b.phone=r.normalized)
 AND lower(coalesce(r.agent_disposition,'')) NOT IN ('completed','resolved','called_back','deceased','dnc','do_not_call','wrong_number')
 AND coalesce(r.caller_speech,'') !~ '\y(deceased|dead|died|cemetery|funeral|passed away)\y'
 AND coalesce(r.caller_speech,'') !~ '(stop calling|do not call|don.t call|remove (me|my number)|take me off|wrong number)'
 AND (coalesce(r.caller_speech,'') !~ '(we are not available now|we.re not available now|automated voice messaging system|number you are calling is not accepting|after the (tone|beep)|leave (a |your |us )?message|mailbox|you have reached|calls to this number are being screened)'
      OR coalesce(r.transcript,'') ~* '(^|\n)\s*(user|human):\s*(yes|yeah|yep|speaking|this is |who |what |why |no |i am |i.m |he is |she is )')
 AND NOT coalesce(r.bridge_confirmed,false)
 AND NOT EXISTS(SELECT 1 FROM public.federal_one_zadarma_calls n WHERE n.bland_call_id=r.id AND n.agent_id=r.agent_id AND n.direction='inbound' AND (n.answered_at IS NOT NULL OR n.disposition='answered') AND NOT coalesce(n.voicemail_reached,false))
 AND NOT EXISTS(SELECT 1 FROM public.federal_one_zadarma_calls n WHERE n.agent_id=p_agent_id AND n.direction='outbound'
   AND public.normalize_phone(n.called_number)=r.normalized AND n.started_at>=r.created_at AND (n.answered_at IS NOT NULL OR n.disposition='answered') AND NOT coalesce(n.voicemail_reached,false))
 AND NOT EXISTS(SELECT 1 FROM public.calls later WHERE later.agent_id=p_agent_id AND public.normalize_phone(later.consumer_phone)=r.normalized
   AND (later.created_at,later.id)>(r.created_at,r.id) AND (coalesce(later.bridge_confirmed,false) OR lower(coalesce(later.agent_disposition,'')) IN ('completed','resolved','called_back')))
), unique_contacts AS MATERIALIZED (
 SELECT DISTINCT ON(normalized) * FROM candidate ORDER BY normalized,created_at DESC,id DESC
), page AS (
 SELECT id,consumer_name,consumer_phone,consumer_address,created_at,ai_summary,drop_reason,transfer_requested_at,agent_notes,
 CASE WHEN transfer_requested_at IS NOT NULL THEN 'Transfer not answered' WHEN drop_reason='declined' THEN 'Transfer declined' ELSE 'Human response · agent follow-up' END callback_reason
 FROM unique_contacts ORDER BY created_at DESC,id DESC LIMIT 100
)
SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY created_at DESC,id DESC) FROM page p),'[]'::jsonb),
 'total',(SELECT count(*) FROM unique_contacts),'as_of',now(),'display_limit',100);
$function$;

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
  (SELECT count(*) FROM scoped c WHERE c.agent_id=a.id AND EXISTS(SELECT 1 FROM federal_one_zadarma_calls n WHERE n.bland_call_id=c.id AND n.agent_id=c.agent_id AND n.direction='inbound' AND (n.answered_at IS NOT NULL OR n.disposition='answered') AND NOT coalesce(n.voicemail_reached,false))) AS transfer_answers,
  (SELECT count(*) FROM native n WHERE n.agent_id=a.id AND n.direction='inbound') AS incoming,
  (SELECT count(*) FROM native n WHERE n.agent_id=a.id AND n.direction='inbound' AND (n.answered_at IS NOT NULL OR n.disposition='answered') AND NOT coalesce(n.voicemail_reached,false)) AS answered,
  (SELECT count(*) FROM native n WHERE n.agent_id=a.id AND n.direction='inbound' AND n.voicemail_reached) AS voicemail_reached,
  (SELECT count(*) FROM native n WHERE n.agent_id=a.id AND n.direction='inbound' AND n.ended_at IS NOT NULL AND n.answered_at IS NULL AND coalesce(n.disposition,'')<>'answered' AND NOT coalesce(n.voicemail_reached,false) AND coalesce(n.disposition,'unconfirmed')<>'unconfirmed') AS missed,
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
   'linked_received',count(*) FILTER(WHERE EXISTS(SELECT 1 FROM federal_one_zadarma_calls n WHERE n.bland_call_id=c.id AND n.agent_id=c.agent_id AND n.direction='inbound')),
   'linked_answered',count(*) FILTER(WHERE EXISTS(SELECT 1 FROM federal_one_zadarma_calls n WHERE n.bland_call_id=c.id AND n.agent_id=c.agent_id AND n.direction='inbound' AND (n.answered_at IS NOT NULL OR n.disposition='answered') AND NOT coalesce(n.voicemail_reached,false))),
   'linked_voicemail',count(*) FILTER(WHERE EXISTS(SELECT 1 FROM federal_one_zadarma_calls n WHERE n.bland_call_id=c.id AND n.agent_id=c.agent_id AND n.direction='inbound' AND n.voicemail_reached)),
   'minutes',round(coalesce(sum(duration_seconds),0)::numeric/60,1)) FROM scoped c),
  'zadarma',(SELECT jsonb_build_object('incoming',count(*) FILTER(WHERE direction='inbound'),'outgoing',count(*) FILTER(WHERE direction='outbound'),
   'answered',count(*) FILTER(WHERE direction='inbound' AND (answered_at IS NOT NULL OR disposition='answered') AND NOT coalesce(voicemail_reached,false)),
   'voicemail_reached',count(*) FILTER(WHERE direction='inbound' AND voicemail_reached),
   'missed',count(*) FILTER(WHERE direction='inbound' AND ended_at IS NOT NULL AND answered_at IS NULL AND coalesce(disposition,'')<>'answered' AND NOT coalesce(voicemail_reached,false) AND coalesce(disposition,'unconfirmed')<>'unconfirmed'),
   'unconfirmed',count(*) FILTER(WHERE direction='inbound' AND answered_at IS NULL AND coalesce(disposition,'')<>'answered' AND NOT coalesce(voicemail_reached,false) AND (ended_at IS NOT NULL AND coalesce(disposition,'unconfirmed')='unconfirmed' OR ended_at IS NULL AND updated_at<=now()-interval '5 minutes')),
   'ringing',count(*) FILTER(WHERE direction='inbound' AND ended_at IS NULL AND answered_at IS NULL AND coalesce(disposition,'')<>'answered' AND NOT coalesce(voicemail_reached,false) AND updated_at>now()-interval '5 minutes'),
   'connected',count(*) FILTER(WHERE direction='inbound' AND ended_at IS NULL AND answered_at IS NOT NULL AND NOT coalesce(voicemail_reached,false) AND updated_at>now()-interval '5 minutes'),
   'linked_transfers',count(*) FILTER(WHERE direction='inbound' AND EXISTS(SELECT 1 FROM calls linked WHERE linked.id=native.bland_call_id AND linked.agent_id=native.agent_id)),
   'unlinked_incoming',count(*) FILTER(WHERE direction='inbound' AND bland_call_id IS NULL),
   'outgoing_answered',count(*) FILTER(WHERE direction='outbound' AND (answered_at IS NOT NULL OR disposition='answered') AND NOT coalesce(voicemail_reached,false))) FROM native),
  'voicemail',(SELECT jsonb_build_object('messages',count(*) FILTER(WHERE received_at>=v_since),'unheard',count(*) FILTER(WHERE received_at>=v_since AND heard_at IS NULL),'unheard_backlog',count(*) FILTER(WHERE heard_at IS NULL)) FROM voicemail),
  'outcomes',(SELECT jsonb_object_agg(outcome,n) FROM(SELECT outcome,count(*) AS n FROM outcomes GROUP BY outcome)o),
  'agents',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY full_name) FROM per_agent p),'[]'::jsonb),
  'hourly',coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY hour) FROM hourly h),'[]'::jsonb),
  'recent_calls',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY started_at DESC) FROM(SELECT n.pbx_call_id,a.full_name,n.direction,n.caller_number,n.called_number,n.started_at,n.disposition,n.voicemail_reached,
   ((n.answered_at IS NOT NULL OR n.disposition='answered') AND NOT coalesce(n.voicemail_reached,false)) AS answered,n.duration_seconds,(nullif(n.recording_id,'') IS NOT NULL) AS recording_available,
   (n.direction='inbound' AND EXISTS(SELECT 1 FROM calls linked WHERE linked.id=n.bland_call_id AND linked.agent_id=n.agent_id)) AS linked_transfer FROM native n LEFT JOIN agents a ON a.id=n.agent_id ORDER BY n.started_at DESC LIMIT 12)r),'[]'::jsonb),
  'events_enabled',coalesce((SELECT value='true' FROM system_config WHERE key='zadarma_call_events_configured'),false),
  'events_since',(SELECT value FROM system_config WHERE key='zadarma_call_events_since'),
  'last_event_at',(SELECT max(received_at) FROM federal_one_zadarma_events WHERE p_agent_id IS NULL OR agent_id=p_agent_id),
  'dialer_runtime',public.get_dialer_runtime()
 ) INTO v_result;
 RETURN v_result;
END;
$function$;
