/*
# Fix import_leads to include all NOT NULL columns
# The original function was missing original_agent_information column
*/
CREATE OR REPLACE FUNCTION public.import_leads(p_leads jsonb, p_filename text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead jsonb;
  v_valid integer := 0;
  v_invalid integer := 0;
  v_import_id uuid;
BEGIN
  INSERT INTO public.lead_imports (filename, total_rows, valid_rows, invalid_rows, status)
  VALUES (p_filename, jsonb_array_length(p_leads), 0, 0, 'processing')
  RETURNING id INTO v_import_id;

  FOR v_lead IN SELECT * FROM jsonb_array_elements(p_leads) LOOP
    IF v_lead->>'name' IS NOT NULL AND v_lead->>'telephone_original' IS NOT NULL THEN
      INSERT INTO public.leads (
        name, telephone_original, telephone_normalized, address,
        income_range, home_value, property_information, notes,
        original_agent_information, source, custom_fields, status
      ) VALUES (
        v_lead->>'name',
        v_lead->>'telephone_original',
        public.normalize_phone(v_lead->>'telephone_original'),
        COALESCE(v_lead->>'address', ''),
        COALESCE(v_lead->>'income_range', ''),
        COALESCE(v_lead->>'home_value', ''),
        COALESCE(v_lead->>'property_information', ''),
        COALESCE(v_lead->>'notes', ''),
        '',
        COALESCE(v_lead->>'source', ''),
        COALESCE(v_lead->'custom_fields', '{}'::jsonb),
        'new'
      );
      v_valid := v_valid + 1;
    ELSE
      v_invalid := v_invalid + 1;
    END IF;
  END LOOP;

  UPDATE public.lead_imports
  SET valid_rows = v_valid, invalid_rows = v_invalid, status = 'completed'
  WHERE id = v_import_id;

  RETURN jsonb_build_object('success', true, 'imported', v_valid, 'invalid', v_invalid, 'import_id', v_import_id);
END;
$$;

REVOKE ALL ON FUNCTION public.import_leads(jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_leads(jsonb, text) TO authenticated, anon;
