-- Exercise both production search signatures against isolated fixtures.
-- No fixture or call remains after the inner transaction rolls back.
DO $test$
DECLARE
  v_tag text := 'CodexSearch' || replace(gen_random_uuid()::text,'-','');
  v_phone text := '+12025550191';
  v_agent uuid;
  v_lead uuid := gen_random_uuid();
  v_call uuid := gen_random_uuid();
  v_data jsonb;
  v_item jsonb;
  v_first_id text;
BEGIN
  SELECT id INTO v_agent FROM public.agents ORDER BY created_at LIMIT 1;
  IF v_agent IS NULL THEN RAISE EXCEPTION 'An existing agent is required for fixtures'; END IF;
  IF EXISTS (SELECT 1 FROM public.calls WHERE public.phone_last10(consumer_phone)='2025550191')
    OR EXISTS (SELECT 1 FROM public.leads WHERE public.phone_last10(telephone_normalized)='2025550191') THEN
    RAISE EXCEPTION 'Reserved regression phone unexpectedly exists';
  END IF;
  BEGIN
    INSERT INTO public.leads(id,name,telephone_original,telephone_normalized,address,income_range,home_value,
      property_information,notes,original_agent_information,custom_fields,status,source,created_at)
    VALUES(v_lead,v_tag||' Main','(202) 555-0191',v_phone,'12 Fixture St., Test City','Fixture income','Fixture home',
      'Fixture property','Original lead notes','Original agent info',
      jsonb_build_object('email',lower(v_tag)||'_client@example.test','Account reference','fixture-account','Nested',jsonb_build_object('field','retained')),
      'closed','historical-fixture',now()-interval '1 year');

    INSERT INTO public.calls(id,lead_id,agent_id,provider_call_id,consumer_phone,consumer_custom_fields,created_at,
      queue,is_completed,agent_notes,is_dnc)
    VALUES(v_call,v_lead,v_agent,'codex-regression-'||v_call,v_phone,'{"Alternate field":"call value"}',
      now()-interval '6 months','no_answer',true,'Call notes',true);

    v_data := public.search_contacts(lower(v_tag)||'_client@example.test',50,0);
    IF (v_data->>'total')::integer<>1 THEN RAISE EXCEPTION 'Email search must return one merged historical contact'; END IF;
    v_item := v_data->'results'->0;
    IF v_item->>'source'<>'call' OR v_item->>'id'<>v_call::text
      OR v_item->>'consumer_name'<>v_tag||' Main' OR v_item->>'address'<>'12 Fixture St., Test City'
      OR v_item->>'income_range'<>'Fixture income' OR v_item->>'home_value'<>'Fixture home'
      OR v_item->>'property_information'<>'Fixture property' OR v_item->>'original_agent_information'<>'Original agent info'
      OR v_item->'custom_fields'->>'email'<>lower(v_tag)||'_client@example.test'
      OR v_item->'custom_fields'->>'Alternate field'<>'call value'
      OR v_item->'custom_fields'->'Nested'->>'field'<>'retained'
      OR (v_item->>'total_call_count')::integer<>1 OR v_item->>'is_dnc'<>'true'
      OR v_item->>'notes'<>'Original lead notes' OR v_item->>'agent_notes'<>'Call notes' THEN
      RAISE EXCEPTION 'Blank call fields must not overwrite complete lead details or custom information';
    END IF;
    v_data := public.search_contacts('+1 (202) 555-0191',50,0);
    IF (v_data->>'total')::integer<>1 OR v_data->'results'->0->>'id'<>v_call::text THEN
      RAISE EXCEPTION 'Formatted phone matching and canonical deduplication failed';
    END IF;
    v_data := public.search_contacts(v_tag||' Main',0);
    IF (v_data->>'total')::integer<>1 THEN RAISE EXCEPTION 'Two-parameter compatibility function failed'; END IF;

    INSERT INTO public.retry_leads(phone_normalized,consumer_name,custom_fields,status)
    VALUES('+12025550192',v_tag||' Retry',jsonb_build_object('Email',lower(v_tag)||'_retry@example.test'),'closed');
    INSERT INTO public.transfer_context(phone_normalized,agent_id,consumer_name,consumer_custom_fields)
    VALUES('+12025550193',v_agent,v_tag||' Transfer',jsonb_build_object('E-mail Address',lower(v_tag)||'_transfer@example.test'));
    INSERT INTO public.secretary_calls(agent_id,client_name,client_phone,provider_call_id,status,created_at)
    VALUES(v_agent,v_tag||' Secretary','+12025550194','codex-regression-'||gen_random_uuid(),'completed',now()-interval '1 year');
    INSERT INTO public.saved_transfers(agent_id,consumer_name,consumer_phone,notes,is_active,deleted_at)
    VALUES(v_agent,v_tag||' Saved','+12025550195','Saved contact detail',false,now());

    v_data := public.search_contacts(v_tag,50,0);
    IF (v_data->>'total')::integer<>5 THEN RAISE EXCEPTION 'Historical sources missing from global contact search'; END IF;
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_data->'results') x WHERE x->>'source'='secretary')
      OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_data->'results') x WHERE x->>'source'='saved_transfer')
      OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_data->'results') x WHERE x->>'source'='retry' AND x->>'email'=lower(v_tag)||'_retry@example.test')
      OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_data->'results') x WHERE x->>'source'='transfer' AND x->>'email'=lower(v_tag)||'_transfer@example.test') THEN
      RAISE EXCEPTION 'Source records or differently named email fields missing';
    END IF;
    v_data := public.search_contacts(lower(v_tag)||'_retry@example.test',50,0);
    IF (v_data->>'total')::integer<>1 THEN RAISE EXCEPTION 'Retry-only email must be searchable'; END IF;

    INSERT INTO public.leads(name,custom_fields,status)
    VALUES(v_tag||' NoPhone one',jsonb_build_object('email','one@example.test'),'closed'),
      (v_tag||' NoPhone two',jsonb_build_object('email','two@example.test'),'closed'),
      (v_tag||' literal%_match','{}','closed'),
      (v_tag||' literalXXmatch','{}','closed');
    v_data := public.search_contacts(v_tag||' NoPhone',50,0);
    IF (v_data->>'total')::integer<>2 THEN RAISE EXCEPTION 'Contacts without phones must not collapse together'; END IF;
    v_data := public.search_contacts(v_tag||' literal%_',50,0);
    IF (v_data->>'total')::integer<>1 THEN RAISE EXCEPTION 'Search percent and underscore must be literal'; END IF;
    v_data := public.search_contacts(v_tag,2,0);
    IF (v_data->>'total')::integer<>9 OR jsonb_array_length(v_data->'results')<>2 THEN RAISE EXCEPTION 'Pagination total or page size incorrect'; END IF;
    v_first_id := v_data->'results'->0->>'id';
    v_data := public.search_contacts(v_tag,2,2);
    IF jsonb_array_length(v_data->'results')<>2
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_data->'results') x WHERE x->>'id'=v_first_id) THEN
      RAISE EXCEPTION 'Pagination overlaps or skips a page';
    END IF;
    v_data := public.search_contacts(v_tag,50,1000);
    IF jsonb_array_length(v_data->'results')<>0 OR (v_data->>'total')::integer<>9 THEN RAISE EXCEPTION 'Offset and total inconsistent'; END IF;
    v_data := public.search_contacts('',50,0);
    IF (v_data->>'total')::integer<>0 THEN RAISE EXCEPTION 'Empty search must return no contacts'; END IF;

    RAISE EXCEPTION USING ERRCODE='PT001', MESSAGE='regression fixtures rollback';
  EXCEPTION WHEN SQLSTATE 'PT001' THEN NULL;
  END;
  IF has_function_privilege('anon','public.search_contacts(text,integer,integer)','EXECUTE')
    OR has_function_privilege('authenticated','public.search_contacts(text,integer,integer)','EXECUTE')
    OR has_function_privilege('anon','public.search_contacts(text,integer)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.search_contacts(text,integer,integer)','EXECUTE') THEN
    RAISE EXCEPTION 'Contact directory must be accessed through the session-verified API';
  END IF;
END;
$test$;
