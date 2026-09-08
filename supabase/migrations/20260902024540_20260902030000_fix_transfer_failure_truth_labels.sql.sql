/*
# Fix transfer failure truth-labeling in get_recent_errors

## Problem
The get_recent_errors function returns transfer_failure_reason as-is from the
calls table. The webhook writes a generic "Transfer failed or destination did not answer"
message for ALL transfer_failed states, regardless of whether a Talkroute leg was
ever created, answered, or bridge-confirmed. This makes the dashboard show
"Transfer failed or destination did not answer" even when the call ended before
Talkroute was dialed at all (talkroute_leg_created=false, duration=0).

## Fix
Replace the raw transfer_failure_reason text with a precise CASE expression that
classifies the failure into one of four truth categories based on the actual
call-leg evidence columns:

1. talkroute_leg_created = false → "Transfer ended before Talkroute was dialed"
2. talkroute_leg_created = true, talkroute_answered = false → "Talkroute destination did not answer"
3. talkroute_leg_created = true, talkroute_answered = true, bridge_confirmed = false → "Answered, bridge unverified"
4. bridge_confirmed = true → not a failure (excluded by WHERE clause)

Also add talkroute_leg_created to the returned JSON so the frontend can classify
without relying on string matching.

## Changes
1. Modified function: public.get_recent_errors(integer)
   - Added talkroute_leg_created to SELECT output
   - Replaced reason CASE for transfer_failure_reason rows with precise classification
   - Preserved auto_killed and bland_api_error reason branches
   - Preserved WHERE filter, ORDER BY, LIMIT, SECURITY DEFINER, search_path, grants
2. No schema changes, no new tables, no new columns, no RLS changes
3. No data writes — function definition change only
*/

CREATE OR REPLACE FUNCTION public.get_recent_errors(p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_errors jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_errors
  FROM (
    SELECT
      c.created_at,
      c.consumer_phone,
      c.consumer_name,
      ag.full_name AS agent_name,
      CASE
        WHEN c.transfer_failure_reason <> '' THEN 'transfer_failure'
        WHEN c.agent_notes ILIKE '%Auto-killed%' THEN 'auto_killed'
        WHEN c.agent_notes ILIKE '%Bland API error%' THEN 'bland_api_error'
        ELSE 'other_error'
      END AS error_type,
      CASE
        WHEN c.transfer_failure_reason <> '' THEN
          CASE
            WHEN c.bridge_confirmed = true THEN 'Transfer succeeded (bridge confirmed)'
            WHEN c.talkroute_leg_created = false THEN 'Transfer ended before Talkroute was dialed'
            WHEN c.talkroute_answered = false THEN 'Talkroute destination did not answer'
            WHEN c.talkroute_answered = true THEN 'Answered, bridge unverified'
            ELSE c.transfer_failure_reason
          END
        WHEN c.agent_notes ILIKE '%Auto-killed%' THEN substring(c.agent_notes from position('Auto-killed' in c.agent_notes) for 120)
        WHEN c.agent_notes ILIKE '%Bland API error%' THEN substring(c.agent_notes from position('Bland API error' in c.agent_notes) for 120)
        ELSE c.agent_notes
      END AS reason,
      c.queue,
      c.duration_seconds,
      c.talkroute_leg_created,
      c.talkroute_answered,
      c.bridge_confirmed
    FROM public.calls c
    LEFT JOIN public.agents ag ON ag.id = c.agent_id
    WHERE c.transfer_failure_reason <> ''
       OR c.agent_notes ILIKE '%Auto-killed%'
       OR c.agent_notes ILIKE '%Bland API error%'
    ORDER BY c.created_at DESC
    LIMIT p_limit
  ) t;
  RETURN v_errors;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_recent_errors(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_recent_errors(integer) TO authenticated;