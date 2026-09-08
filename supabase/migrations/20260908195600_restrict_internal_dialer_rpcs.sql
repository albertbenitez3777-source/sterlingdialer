-- Application sessions are checked by wolf-provider. Browser clients must not
-- call these server-side RPCs directly with an anon or Supabase Auth key.
DO $migration$
DECLARE
  v_function regprocedure;
BEGIN
  FOR v_function IN
    SELECT p.oid::regprocedure
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN (
      'create_transfer_context', 'dialer_next_batch', 'get_active_transfers',
      'get_admin_chart_data_v2', 'get_agent_opportunities', 'get_agent_workspace',
      'get_retry_campaign_stats', 'get_transfer_proof_stats', 'pre_call_snapshot',
      'retry_dialer_next_batch', 'upsert_call_audit', 'get_admin_stats',
      'get_agent_stats', 'get_agent_today_activity', 'get_roster_attendance'
    )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_function);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_function);
  END LOOP;
END;
$migration$;

ALTER FUNCTION public.phone_last10(text) SET search_path = public;
ALTER FUNCTION public.ensure_transfer_live() SET search_path = public;
ALTER FUNCTION public.norm_xfer() SET search_path = public;
