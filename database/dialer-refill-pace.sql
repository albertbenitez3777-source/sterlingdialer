-- Raise the configurable hourly bound without changing any campaign here.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.campaigns'::regclass
      AND conname='campaigns_hourly_call_target_check'
      AND pg_get_constraintdef(oid)='CHECK (((hourly_call_target >= 1) AND (hourly_call_target <= 400)))'
  ) THEN RAISE EXCEPTION 'Pacing constraint changed; review before applying'; END IF;
  ASSERT public.dialer_rate_allowance(1000,400,0,25)=25;
  ASSERT public.dialer_rate_allowance(1000,400,25,25)=0;
  ASSERT public.dialer_rate_allowance(1000,1000,0,25)=0;
  ASSERT public.dialer_pool_capacity(25,1)=25;
  ASSERT public.dialer_pool_capacity(25,2)=25;
  ASSERT public.dialer_run_remaining(400,400,25)=0;
END;
$guard$;

ALTER TABLE public.campaigns
  DROP CONSTRAINT campaigns_hourly_call_target_check,
  ADD CONSTRAINT campaigns_hourly_call_target_check
    CHECK (hourly_call_target >= 1 AND hourly_call_target <= 1000);

