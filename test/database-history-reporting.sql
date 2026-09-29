-- Transactional fixtures rollback before the test ends.

DO $test$
DECLARE
 j uuid:='c242abef-c01e-490b-bab6-859cd89bd08a';
 m uuid:='03f30cd4-b21e-4a40-a611-df6cfd49d0ff';
 link uuid; prefix text:='report-regression-'||gen_random_uuid()::text;
 before_report jsonb; after_report jsonb;
 jb jsonb; ja jsonb; mb jsonb; ma jsonb;
 ob jsonb; oa jsonb; omb jsonb; oma jsonb;
 d date:=(now() AT TIME ZONE 'America/Costa_Rica')::date;
BEGIN
 SELECT id INTO link FROM public.calls WHERE agent_id=j ORDER BY created_at DESC LIMIT 1;
 IF link IS NULL THEN RAISE EXCEPTION 'Test requires an existing assigned call'; END IF;
 before_report:=public.federal_one_monitoring_report(d,NULL,0);
 SELECT x INTO jb FROM jsonb_array_elements(before_report->'agents') x WHERE x->>'id'=j::text;
 SELECT x INTO mb FROM jsonb_array_elements(before_report->'agents') x WHERE x->>'id'=m::text;
 ob:=public.get_operations_overview(j,'today'); omb:=public.get_operations_overview(m,'today');
 BEGIN
  INSERT INTO public.federal_one_zadarma_calls(pbx_call_id,agent_id,bland_call_id,direction,started_at,ended_at,disposition,voicemail_reached,duration_seconds)
  VALUES(prefix||'-callback',j,link,'outbound',now()-interval '10 minutes',now()-interval '9 minutes','answered',false,60),
        (prefix||'-other-agent',m,link,'inbound',now()-interval '10 minutes',now()-interval '9 minutes','answered',false,60),
        (prefix||'-voicemail',j,NULL,'inbound',now()-interval '10 minutes',now()-interval '9 minutes','answered',true,60);
  after_report:=public.federal_one_monitoring_report(d,NULL,0);
  SELECT x INTO ja FROM jsonb_array_elements(after_report->'agents') x WHERE x->>'id'=j::text;
  SELECT x INTO ma FROM jsonb_array_elements(after_report->'agents') x WHERE x->>'id'=m::text;
  oa:=public.get_operations_overview(j,'today'); oma:=public.get_operations_overview(m,'today');

  IF (ja->>'outbound_calls')::int IS DISTINCT FROM (jb->>'outbound_calls')::int+1
   OR (ja->>'outbound_answered')::int IS DISTINCT FROM (jb->>'outbound_answered')::int+1
   OR (ja->>'transfers_received')::int IS DISTINCT FROM (jb->>'transfers_received')::int
   OR (ja->>'transfers_answered')::int IS DISTINCT FROM (jb->>'transfers_answered')::int
   OR (ja->>'connected_seconds')::int IS DISTINCT FROM (jb->>'connected_seconds')::int
   OR (ja->>'inbound_answered')::int IS DISTINCT FROM (jb->>'inbound_answered')::int
  THEN RAISE EXCEPTION 'Linked outbound callback or voicemail reporting incorrect'; END IF;
  IF (ma->>'inbound_answered')::int IS DISTINCT FROM (mb->>'inbound_answered')::int+1
   OR (ma->>'transfers_received')::int IS DISTINCT FROM (mb->>'transfers_received')::int
  THEN RAISE EXCEPTION 'Cross-agent transfer association not excluded'; END IF;
  IF (oa#>>'{zadarma,outgoing_answered}')::int IS DISTINCT FROM (ob#>>'{zadarma,outgoing_answered}')::int+1
   OR (oa#>>'{zadarma,answered}')::int IS DISTINCT FROM (ob#>>'{zadarma,answered}')::int
   OR (oma#>>'{zadarma,answered}')::int IS DISTINCT FROM (omb#>>'{zadarma,answered}')::int+1
   OR (oma#>>'{zadarma,missed}')::int IS DISTINCT FROM (omb#>>'{zadarma,missed}')::int
   OR (oa#>>'{bland,linked_answered}')::int IS DISTINCT FROM (ob#>>'{bland,linked_answered}')::int
   OR (oa#>>'{voicemail,messages}')::int IS DISTINCT FROM (ob#>>'{voicemail,messages}')::int
  THEN RAISE EXCEPTION 'Operations answer/missed/voicemail reporting incorrect'; END IF;
  RAISE EXCEPTION 'Rollback synthetic reporting fixtures' USING ERRCODE='P9002';
 EXCEPTION WHEN SQLSTATE 'P9002' THEN NULL;
 END;
 IF EXISTS(SELECT 1 FROM public.federal_one_zadarma_calls WHERE pbx_call_id LIKE prefix||'%') THEN
 RAISE EXCEPTION 'Test fixture rollback failed'; END IF;
END $test$;
