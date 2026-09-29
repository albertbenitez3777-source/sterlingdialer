-- Run in a transaction; all synthetic records roll back.
BEGIN;
DO $test$
DECLARE v_before bigint; v_after bigint; v_data jsonb; v_row public.federal_one_zadarma_calls%ROWTYPE;
BEGIN
 SELECT count(*) INTO v_before FROM public.federal_one_voicemails;
 v_data:=jsonb_build_array(
 jsonb_build_object('pbx_call_id','in_overnight_test_answer','sip','100','destination','12027739590','callstart','2026-09-28 13:00:00','clid','Test <15555550123>','disposition','answered','seconds',30,'is_recorded',false),
 jsonb_build_object('pbx_call_id','out_overnight_test_outbound','sip','100','destination','15555550124','callstart','2026-09-28 13:05:00','clid','100','disposition','answered','seconds',25,'is_recorded',false),
 jsonb_build_object('pbx_call_id','in_overnight_test_voicemail','sip','8500','destination','12027739590','callstart','2026-09-28 13:10:00','clid','Test <15555550125>','disposition','answered','seconds',10,'is_recorded',true,'call_id','test-recording')
 );
 PERFORM public.apply_verified_zadarma_call_history(v_data,'2026-09-28T06:00:00Z','2026-09-29T03:00:00Z');
 SELECT * INTO v_row FROM public.federal_one_zadarma_calls WHERE pbx_call_id='in_overnight_test_answer';
 IF v_row.disposition<>'answered' OR v_row.answered_at IS NOT NULL OR v_row.inbox_id IS NOT NULL OR v_row.voicemail_reached THEN RAISE EXCEPTION 'History answer classification or invented timestamp';END IF;
 SELECT * INTO v_row FROM public.federal_one_zadarma_calls WHERE pbx_call_id='out_overnight_test_outbound';
 IF v_row.direction<>'outbound' OR v_row.disposition<>'answered' OR v_row.inbox_id IS NOT NULL THEN RAISE EXCEPTION 'Outbound classification failed';END IF;
 SELECT * INTO v_row FROM public.federal_one_zadarma_calls WHERE pbx_call_id='in_overnight_test_voicemail';
 IF NOT v_row.voicemail_reached OR v_row.answered_at IS NOT NULL THEN RAISE EXCEPTION 'Voicemail incorrectly treated as answer';END IF;
 PERFORM public.apply_verified_zadarma_call_history(v_data,'2026-09-28T06:00:00Z','2026-09-29T03:00:00Z');
 IF (SELECT count(*) FROM public.federal_one_zadarma_calls WHERE pbx_call_id LIKE '%overnight_test%')<>3 THEN RAISE EXCEPTION 'History deduplication failed';END IF;
 SELECT count(*) INTO v_after FROM public.federal_one_voicemails;
 IF v_after<>v_before THEN RAISE EXCEPTION 'History visit created a saved voicemail';END IF;
END;$test$;
ROLLBACK;
