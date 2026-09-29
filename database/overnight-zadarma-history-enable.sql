CREATE OR REPLACE FUNCTION public.reconcile_zadarma_call_history()
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=public AS $history$
 SELECT jsonb_build_object('queued',true,'request_id',public.queue_zadarma_history_reconciliation());
$history$;
REVOKE ALL ON FUNCTION public.reconcile_zadarma_call_history() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_zadarma_call_history() TO service_role;

