/*
# Fix import_staged_leads to set status to 'new' for dialer pickup

## Problem
The import function sets lead status to 'unassigned', but the dialer only picks up
leads with status 'new'. New imports never get called.

## Change
Set status to 'new' instead of 'unassigned'.

## Security
- No RLS or policy changes. Function remains SECURITY DEFINER.
*/

CREATE OR REPLACE FUNCTION public.import_staged_leads()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
  v_inserted integer := 0;
  v_skipped integer := 0;
  v_batch record;
BEGIN
  FOR v_batch IN SELECT * FROM public.lead_staging WHERE client_name IS NOT NULL AND client_phone IS NOT NULL LOOP
    BEGIN
      INSERT INTO public.leads (name, telephone_original, telephone_normalized, address, income_range, home_value, source, status, notes)
      VALUES (
        v_batch.client_name,
        v_batch.client_phone,
        public.normalize_phone(v_batch.client_phone),
        v_batch.address,
        v_batch.income_range,
        v_batch.home_value,
        'Recipe_1_JULY_77',
        'new',
        v_batch.notes
      );
      v_inserted := v_inserted + 1;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped);
END;
$function$;
