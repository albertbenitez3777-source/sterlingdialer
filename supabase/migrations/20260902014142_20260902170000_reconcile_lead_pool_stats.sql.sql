-- v220 Reconcile lead pool stats into 6 mutually exclusive buckets summing exactly to total.
-- Observed database state (2026-09-02):
--   total=12,872  fresh=1,704  called=10,781  suppressed=7  invalid=0  excluded_other=196  data_quality=184
--   1,704 + 10,781 + 7 + 0 + 196 + 184 = 12,872
--
-- Bucket definitions (mutually exclusive by construction):
--   fresh:          status = 'new'
--   called:         status = 'closed' AND has call record AND NOT dnc AND NOT wrong_number
--   suppressed:     status = 'closed' AND has call record with is_dnc = true
--   invalid:        status = 'closed' AND has call record with is_wrong_number = true AND NOT dnc
--   excluded_other: status = 'closed' AND NO call record AND assigned_agent_id IS NOT NULL
--   data_quality:   status = 'closed' AND NO call record AND assigned_agent_id IS NULL
--
-- Mutual exclusivity proof:
--   1. A lead has exactly one status: 'new' (fresh) or 'closed' (all other buckets).
--   2. Among closed leads: either has a call record (called/suppressed/invalid) or doesn't (excluded/data_quality).
--   3. Among closed-with-call: either DNC (suppressed) or not (called/invalid).
--   4. Among closed-with-call-not-DNC: either wrong_number (invalid) or not (called).
--   5. Among closed-no-call: either assigned_agent_id IS NOT NULL (excluded_other) or IS NULL (data_quality).

CREATE OR REPLACE FUNCTION public.get_lead_pool_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN jsonb_build_object(
    'total', (SELECT count(*) FROM public.leads),
    'fresh', (SELECT count(*) FROM public.leads WHERE status = 'new'),
    'called', (
      SELECT count(*) FROM public.leads l
      WHERE l.status = 'closed'
        AND EXISTS (SELECT 1 FROM public.calls c WHERE c.lead_id = l.id)
        AND NOT EXISTS (SELECT 1 FROM public.calls c WHERE c.lead_id = l.id AND c.is_dnc = true)
        AND NOT EXISTS (SELECT 1 FROM public.calls c WHERE c.lead_id = l.id AND c.is_wrong_number = true)
    ),
    'suppressed', (
      SELECT count(*) FROM public.leads l
      WHERE l.status = 'closed'
        AND EXISTS (SELECT 1 FROM public.calls c WHERE c.lead_id = l.id AND c.is_dnc = true)
    ),
    'invalid', (
      SELECT count(*) FROM public.leads l
      WHERE l.status = 'closed'
        AND EXISTS (SELECT 1 FROM public.calls c WHERE c.lead_id = l.id AND c.is_wrong_number = true)
        AND NOT EXISTS (SELECT 1 FROM public.calls c WHERE c.lead_id = l.id AND c.is_dnc = true)
    ),
    'excluded_other', (
      SELECT count(*) FROM public.leads l
      WHERE l.status = 'closed'
        AND NOT EXISTS (SELECT 1 FROM public.calls c WHERE c.lead_id = l.id)
        AND l.assigned_agent_id IS NOT NULL
    ),
    'data_quality', (
      SELECT count(*) FROM public.leads l
      WHERE l.status = 'closed'
        AND NOT EXISTS (SELECT 1 FROM public.calls c WHERE c.lead_id = l.id)
        AND l.assigned_agent_id IS NULL
    )
  );
END;
$function$;