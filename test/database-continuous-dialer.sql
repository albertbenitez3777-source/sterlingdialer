-- Read-only behavioral checks for the live allowance helper. No dispatch or calls.
DO $test$
BEGIN
  ASSERT public.dialer_run_remaining(NULL, 400, 20) = 20, 'continuous at former limit';
  ASSERT public.dialer_run_remaining(NULL, 100000, 20) = 20, 'continuous well beyond former limit';
  ASSERT public.dialer_run_remaining(NULL, 400, 6) = 6, 'preserve lower line setting';
  ASSERT public.dialer_run_remaining(NULL, 400, 999) = 20, 'continuous reservation budget bounded';
  ASSERT public.dialer_run_remaining(NULL, 400, 0) = 0, 'no capacity';
  ASSERT public.dialer_run_remaining(400, 399, 20) = 1, 'finite last attempt';
  ASSERT public.dialer_run_remaining(400, 400, 20) = 0, 'finite cutoff preserved';
  ASSERT public.dialer_run_remaining(20, 21, 20) = 0, 'test cap remains finite';
  ASSERT public.dialer_run_remaining(0, 0, 20) = 0, 'zero is not unlimited';
END;
$test$;
SELECT '9 continuous/finite allowance assertions passed' AS result;
