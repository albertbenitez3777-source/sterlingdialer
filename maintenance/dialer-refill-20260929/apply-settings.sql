-- Operational change for the exact owner-authorized active run.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.campaigns
    WHERE id='18e7b567-2e3e-4110-8950-bae5803d47fb'
      AND state='running' AND dialer_activated AND concurrency=25
      AND hourly_call_target=400 AND provider_call_limit IS NULL
      AND dispatch_epoch=49 AND started_at='2026-09-29T16:50:03.714126Z'
    FOR UPDATE
  ) THEN RAISE EXCEPTION 'Campaign changed; review operator settings before applying'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobid=2 AND jobname='wolf-dialer-heartbeat'
      AND schedule='20 seconds' AND active
  ) THEN RAISE EXCEPTION 'Dialer schedule changed; review before applying'; END IF;
  ASSERT public.dialer_rate_allowance(1000,400,0,25)=25;
  ASSERT public.dialer_rate_allowance(1000,400,25,25)=0;
  ASSERT public.dialer_rate_allowance(1000,1000,0,25)=0;
  ASSERT public.dialer_pool_capacity(25,1)=25;
  ASSERT public.dialer_pool_capacity(25,2)=25;
  ASSERT public.dialer_run_remaining(400,400,25)=0;
END;
$guard$;

UPDATE public.campaigns SET hourly_call_target=1000,updated_at=now()
WHERE id='18e7b567-2e3e-4110-8950-bae5803d47fb';

-- Alter only schedule: existing signed command, identity and active flag stay intact.
SELECT cron.alter_job(job_id:=2,schedule:='10 seconds');

INSERT INTO public.campaign_events(campaign_id,event_type,event_data)
VALUES ('18e7b567-2e3e-4110-8950-bae5803d47fb','dialer_refill_pace_adjusted',
 jsonb_build_object('previous_hourly_target',400,'hourly_target',1000,
 'previous_interval_seconds',20,'interval_seconds',10,'concurrency',25,
 'reason','Owner reports underfilled 25-line pool; verified rolling 400/hour allowance exhausted',
 'run_restarted',false,'phone_or_route_changed',false));

DO $verify$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM public.campaigns
    WHERE id='18e7b567-2e3e-4110-8950-bae5803d47fb'
      AND state='running' AND dialer_activated AND concurrency=25
      AND hourly_call_target=1000 AND provider_call_limit IS NULL
      AND dispatch_epoch=49 AND started_at='2026-09-29T16:50:03.714126Z');
  ASSERT EXISTS (SELECT 1 FROM cron.job WHERE jobid=2 AND active AND schedule='10 seconds');
END;
$verify$;

COMMIT;
