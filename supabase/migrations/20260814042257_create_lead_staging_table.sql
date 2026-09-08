/*
# Create permanent staging table for CSV lead import
*/
CREATE TABLE IF NOT EXISTS public.lead_staging (
  id text,
  transfer_date text,
  kind text,
  agent_name text,
  client_name text,
  client_phone text,
  address text,
  income_range text,
  home_value text,
  notes text
);

ALTER TABLE public.lead_staging ENABLE ROW LEVEL SECURITY;

-- Function to move staged leads into the real leads table
CREATE OR REPLACE FUNCTION public.import_staged_leads()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
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
        'transfers-and-pending-leads.csv',
        'unassigned',
        v_batch.notes
      );
      v_inserted := v_inserted + 1;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
    END;
  END LOOP;
  
  RETURN jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.import_staged_leads FROM anon;
GRANT EXECUTE ON FUNCTION public.import_staged_leads TO authenticated;
