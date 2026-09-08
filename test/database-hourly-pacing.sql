DO $test$
BEGIN
  IF public.dialer_rate_allowance(400,0,0)<>7
    OR public.dialer_rate_allowance(400,395,0)<>5
    OR public.dialer_rate_allowance(400,400,0)<>0
    OR public.dialer_rate_allowance(400,0,7)<>0
    OR public.dialer_rate_allowance(300,0,0)<>5
    OR public.dialer_rate_allowance(300,295,4)<>1
    OR public.dialer_rate_allowance(400,9999,99)<>0 THEN
    RAISE EXCEPTION 'Hourly/minute pacing regression failed';
  END IF;
  IF position('public.dialer_rate_allowance(v_campaign.hourly_call_target' in pg_get_functiondef('public.dialer_next_batch()'::regprocedure))=0
    OR position('Auto-cleaned: stale pending' in pg_get_functiondef('public.dialer_next_batch()'::regprocedure))>0 THEN
    RAISE EXCEPTION 'Dialer must enforce pacing and preserve provider-pending calls';
  END IF;
END;
$test$;
