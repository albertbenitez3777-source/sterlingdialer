-- Transactional regression checks: all fixtures and RPC side effects are rolled back.
-- These checks only call database functions; they never contact Bland.
DO $test$
DECLARE
  v_pending_id uuid := gen_random_uuid();
  v_completed_id uuid := gen_random_uuid();
  v_placeholder_id uuid := gen_random_uuid();
  v_result jsonb;
BEGIN
  BEGIN
    INSERT INTO public.campaigns(state, created_at, started_at, provider_call_limit, concurrency)
    VALUES ('running', now() + interval '1 day', now(), 0, 0);

    INSERT INTO public.calls(id, provider_call_id, queue, is_completed, created_at)
    VALUES
      (v_pending_id, 'codex-regression-' || v_pending_id, 'pending', false, now() - interval '15 minutes'),
      (v_completed_id, 'codex-regression-' || v_completed_id, 'no_answer', true, now() - interval '15 minutes'),
      (v_placeholder_id, '', 'pending', false, now() - interval '4 minutes');

    v_result := public.dialer_next_batch();
    IF v_result->>'message' IS DISTINCT FROM 'Call limit reached' THEN
      RAISE EXCEPTION 'Test campaign must not allocate calls: %', v_result;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.calls WHERE id=v_pending_id AND queue='pending' AND NOT is_completed) THEN
      RAISE EXCEPTION 'dialer_next_batch falsely completed a provider-accepted call by age';
    END IF;
    IF EXISTS (SELECT 1 FROM public.calls WHERE id=v_placeholder_id) THEN
      RAISE EXCEPTION 'Unsubmitted placeholder cleanup must still work';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.calls WHERE id=v_completed_id AND queue='no_answer' AND is_completed) THEN
      RAISE EXCEPTION 'Confirmed terminal call must retain its outcome';
    END IF;

    v_result := public.campaign_start(1, 1);
    IF v_result->>'success' IS DISTINCT FROM 'false' THEN
      RAISE EXCEPTION 'Test campaign must remain protected by already-running check';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.calls WHERE id=v_pending_id AND queue='pending' AND NOT is_completed) THEN
      RAISE EXCEPTION 'campaign_start falsely completed a provider-accepted call by age';
    END IF;

    -- Roll back every fixture, lead update, audit row, and other RPC side effect.
    RAISE EXCEPTION USING ERRCODE='PT001', MESSAGE='regression fixtures rollback';
  EXCEPTION WHEN SQLSTATE 'PT001' THEN
    NULL;
  END;
END;
$test$;
