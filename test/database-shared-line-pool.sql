-- Read-only tests of the exact helpers used by the dispatcher and reporting.
-- Never invoke the reservation/dispatch functions or create customer test calls.
DO $tests$
DECLARE target integer; agents integer; free_slots integer; remaining integer; share integer; i integer;
BEGIN
  FOR target IN 1..25 LOOP
    FOR agents IN 1..3 LOOP
      ASSERT public.dialer_pool_capacity(target,agents)=target, 'agent count must not shrink the pool';
      FOR free_slots IN 0..target LOOP
        remaining:=free_slots;
        FOR i IN 1..agents LOOP
          share:=public.dialer_pool_share(remaining,agents-i+1);
          ASSERT share>=0 AND share<=remaining, 'never over-allocate';
          remaining:=remaining-share;
        END LOOP;
        ASSERT remaining=0, 'allocate every available slot across selected routes';
      END LOOP;
    END LOOP;
  END LOOP;
  ASSERT public.dialer_pool_capacity(25,0)=0, 'no routes';
  ASSERT public.dialer_pool_capacity(25,NULL)=0, 'unknown route count';
  ASSERT public.dialer_pool_capacity(99,1)=25, 'hard global maximum';
  ASSERT public.dialer_pool_share(25,1)=25, 'one agent gets full pool';
  ASSERT public.dialer_pool_share(25,2)=13, 'first of two gets 13';
  ASSERT public.dialer_pool_share(12,1)=12, 'second of two gets the other 12';
  ASSERT public.dialer_pool_share(25,0)=0, 'no assignment without agent';
  ASSERT public.dialer_run_remaining(NULL,10000,25)=25, 'continuous mode preserved';
  ASSERT public.dialer_run_remaining(400,400,25)=0, 'finite test cap preserved';
  ASSERT public.dialer_rate_allowance(400,375,0,25)=25, '25 starts within pacing';
  ASSERT public.dialer_rate_allowance(400,400,0,25)=0, 'hourly protection preserved';
  ASSERT public.dialer_rate_allowance(400,0,25,25)=0, 'minute protection preserved';
END;
$tests$;
SELECT 'Shared pool capacity and allocation passed for every target 1-25, 1-3 agents, and 0-target available slots' AS result;
