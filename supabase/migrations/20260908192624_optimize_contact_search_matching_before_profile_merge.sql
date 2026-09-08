-- Match the Edge Function's three named parameters, search every contact source,
-- and merge nonempty profile fields instead of losing lead data to a blank call.
CREATE OR REPLACE FUNCTION public.search_contacts(p_search text, p_limit integer, p_offset integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET jit TO 'off'
AS $function$
DECLARE
  v_term text := lower(trim(coalesce(p_search,'')));
  v_norm text;
  v_digits text;
  v_phone_search boolean;
  v_result jsonb;
BEGIN
  IF v_term='' THEN RETURN jsonb_build_object('results','[]'::jsonb,'count',0,'total',0); END IF;
  v_norm := regexp_replace(v_term,'[[:space:],.]+',' ','g');
  v_digits := right(regexp_replace(v_term,'[^0-9]','','g'),10);
  v_phone_search := v_term ~ '^[+0-9() .-]+$' AND length(v_digits)>=3;

  WITH matching(source,id,canon) AS MATERIALIZED (
    SELECT 'lead',l.id::text,public.phone_last10(coalesce(nullif(l.telephone_normalized,''),l.telephone_original)) FROM public.leads l
    WHERE (v_phone_search AND strpos(public.phone_last10(coalesce(nullif(l.telephone_normalized,''),l.telephone_original)),v_digits)>0)
      OR strpos(regexp_replace(lower(concat_ws(' ',l.name,l.address,l.income_range,l.home_value,l.property_information,l.notes,l.original_agent_information,l.source,l.custom_fields::text)),'[[:space:],.]+',' ','g'),v_norm)>0
    UNION ALL
    SELECT 'call',c.id::text,public.phone_last10(coalesce(nullif(c.consumer_phone,''),CASE WHEN c.call_direction='inbound' THEN c.from_number ELSE c.to_number END)) FROM public.calls c
    WHERE (v_phone_search AND strpos(public.phone_last10(coalesce(nullif(c.consumer_phone,''),CASE WHEN c.call_direction='inbound' THEN c.from_number ELSE c.to_number END)),v_digits)>0)
      OR strpos(regexp_replace(lower(concat_ws(' ',c.consumer_name,c.consumer_address,c.consumer_income_range,c.consumer_home_value,c.consumer_property_info,c.agent_notes,c.consumer_custom_fields::text)),'[[:space:],.]+',' ','g'),v_norm)>0
    UNION ALL
    SELECT 'retry',r.id::text,public.phone_last10(r.phone_normalized) FROM public.retry_leads r
    WHERE (v_phone_search AND strpos(public.phone_last10(r.phone_normalized),v_digits)>0)
      OR strpos(regexp_replace(lower(concat_ws(' ',r.consumer_name,r.address,r.income_range,r.home_value,r.property_information,r.custom_fields::text)),'[[:space:],.]+',' ','g'),v_norm)>0
    UNION ALL
    SELECT 'transfer',t.id::text,public.phone_last10(t.phone_normalized) FROM public.transfer_context t
    WHERE (v_phone_search AND strpos(public.phone_last10(t.phone_normalized),v_digits)>0)
      OR strpos(regexp_replace(lower(concat_ws(' ',t.consumer_name,t.consumer_address,t.consumer_income_range,t.consumer_home_value,t.consumer_property_info,t.notes,t.consumer_custom_fields::text)),'[[:space:],.]+',' ','g'),v_norm)>0
    UNION ALL
    SELECT 'secretary',s.id::text,public.phone_last10(s.client_phone) FROM public.secretary_calls s
    WHERE (v_phone_search AND strpos(public.phone_last10(s.client_phone),v_digits)>0)
      OR strpos(regexp_replace(lower(concat_ws(' ',s.client_name,s.custom_message)),'[[:space:],.]+',' ','g'),v_norm)>0
    UNION ALL
    SELECT 'saved_transfer',s.id::text,public.phone_last10(s.consumer_phone) FROM public.saved_transfers s
    WHERE (v_phone_search AND strpos(public.phone_last10(s.consumer_phone),v_digits)>0)
      OR strpos(regexp_replace(lower(concat_ws(' ',s.consumer_name,s.consumer_address,s.consumer_income_range,s.consumer_home_value,s.consumer_property_info,s.notes)),'[[:space:],.]+',' ','g'),v_norm)>0
  ), match_keys AS MATERIALIZED (
    SELECT DISTINCT CASE WHEN length(canon)>=7 THEN 'phone:'||canon ELSE source||':'||id END AS contact_key FROM matching
  ), raw(source,id,phone,created_at,rank,profile,custom_fields,submitted,is_dnc,is_wrong_number,is_priority,last_call_time) AS (
    SELECT 'lead',l.id::text,coalesce(nullif(l.telephone_normalized,''),l.telephone_original),l.created_at,50,
      jsonb_build_object('consumer_name',l.name,'phone',l.telephone_original,'phone_normalized',l.telephone_normalized,
        'address',l.address,'income_range',l.income_range,'home_value',l.home_value,'property_information',l.property_information,
        'notes',l.notes,'original_agent_information',l.original_agent_information,'lead_source',l.source,'lead_status',l.status),
      l.custom_fields,false,false,false,l.is_priority,null::timestamptz
    FROM public.leads l
    UNION ALL
    SELECT 'call',c.id::text,coalesce(nullif(c.consumer_phone,''),CASE WHEN c.call_direction='inbound' THEN c.from_number ELSE c.to_number END),c.created_at,60,
      jsonb_build_object('consumer_name',c.consumer_name,'phone',c.consumer_phone,'phone_normalized',c.consumer_phone,
        'address',c.consumer_address,'income_range',c.consumer_income_range,'home_value',c.consumer_home_value,'property_information',c.consumer_property_info),
      c.consumer_custom_fields,coalesce(c.provider_call_id,'')<>'',c.is_dnc,c.is_wrong_number,false,c.created_at
    FROM public.calls c
    UNION ALL
    SELECT 'retry',r.id::text,r.phone_normalized,r.created_at,40,
      jsonb_build_object('consumer_name',r.consumer_name,'phone',r.phone_normalized,'phone_normalized',r.phone_normalized,
        'address',r.address,'income_range',r.income_range,'home_value',r.home_value,'property_information',r.property_information,
        'lead_source','retry','lead_status',r.status),r.custom_fields,false,false,false,false,null::timestamptz
    FROM public.retry_leads r
    UNION ALL
    SELECT 'transfer',t.id::text,t.phone_normalized,t.context_created_at,30,
      jsonb_build_object('consumer_name',t.consumer_name,'phone',t.consumer_phone,'phone_normalized',t.phone_normalized,
        'address',t.consumer_address,'income_range',t.consumer_income_range,'home_value',t.consumer_home_value,
        'property_information',t.consumer_property_info,'notes',t.notes,'lead_source',t.lead_source),
      t.consumer_custom_fields,false,false,false,false,null::timestamptz
    FROM public.transfer_context t
    UNION ALL
    SELECT 'secretary',s.id::text,s.client_phone,s.created_at,20,
      jsonb_build_object('consumer_name',s.client_name,'phone',s.client_phone,'phone_normalized',s.client_phone,'notes',s.custom_message),
      '{}'::jsonb,coalesce(s.provider_call_id,'')<>'',false,false,false,s.created_at
    FROM public.secretary_calls s
    UNION ALL
    SELECT 'saved_transfer',s.id::text,s.consumer_phone,s.created_at,30,
      jsonb_build_object('consumer_name',s.consumer_name,'phone',s.consumer_phone,'phone_normalized',s.consumer_phone,
        'address',s.consumer_address,'income_range',s.consumer_income_range,'home_value',s.consumer_home_value,
        'property_information',s.consumer_property_info,'notes',s.notes),
      '{}'::jsonb,false,false,false,false,null::timestamptz
    FROM public.saved_transfers s
  ), records AS MATERIALIZED (
    SELECT r.*, public.phone_last10(r.phone) AS canon,
      CASE WHEN length(public.phone_last10(r.phone))>=7 THEN 'phone:'||public.phone_last10(r.phone)
        ELSE r.source||':'||r.id END AS contact_key
    FROM raw r
    WHERE CASE WHEN length(public.phone_last10(r.phone))>=7 THEN 'phone:'||public.phone_last10(r.phone)
      ELSE r.source||':'||r.id END IN (SELECT contact_key FROM match_keys)
  ), matched AS MATERIALIZED (
    SELECT * FROM records
  ), grouped AS (
    SELECT contact_key,min(created_at) AS created_at,max(last_call_time) AS last_call_time,
      count(*) FILTER(WHERE submitted) AS total_call_count,
      bool_or(is_dnc) AS is_dnc,bool_or(is_wrong_number) AS is_wrong_number,bool_or(is_priority) AS is_priority,
      string_agg(DISTINCT nullif(profile->>'notes',''),E'\n') AS notes
    FROM matched GROUP BY contact_key
  ), page AS MATERIALIZED (
    SELECT * FROM grouped ORDER BY last_call_time DESC NULLS LAST,created_at DESC,contact_key
    LIMIT least(greatest(coalesce(p_limit,50),1),100) OFFSET greatest(coalesce(p_offset,0),0)
  ), result_rows AS (
    SELECT p.contact_key,p.last_call_time,p.created_at,
      jsonb_build_object('consumer_name','','phone','','phone_normalized','','address','','income_range','',
        'home_value','','property_information','','original_agent_information','','lead_source','','lead_status','')
      || coalesce(fields.profile,'{}'::jsonb)
      || jsonb_build_object('source',r.source,'id',r.id,'contact_key',p.contact_key,
        'created_at',p.created_at,'notes',coalesce(p.notes,''),'custom_fields',coalesce(custom.fields,'{}'::jsonb),
        'emails',coalesce(emails.values,'[]'::jsonb),'email',coalesce(emails.values->>0,''),
        'is_priority',p.is_priority,'is_dnc',p.is_dnc,'is_wrong_number',p.is_wrong_number,
        'total_call_count',p.total_call_count,'last_call_time',p.last_call_time,'agent_name',a.full_name,
        'call_queue',c.queue,'call_disposition',coalesce(nullif(c.disposition,''),c.queue),
        'agent_disposition',c.agent_disposition,'agent_notes',c.agent_notes,
        'ai_summary',coalesce(c.ai_summary,s.ai_summary),'transcript',coalesce(c.transcript,s.transcript),
        'recording_url',coalesce(c.recording_url,s.recording_url),'duration_seconds',coalesce(c.duration_seconds,s.duration_seconds),
        'transfer_status',coalesce(c.transfer_status,s.transfer_status),'callback_requested',c.callback_requested,
        'is_completed',coalesce(c.is_completed,s.status IN ('completed','failed'))) AS data
    FROM page p
    CROSS JOIN LATERAL (
      SELECT * FROM matched m WHERE m.contact_key=p.contact_key
      ORDER BY (m.source IN ('call','secretary')) DESC,m.last_call_time DESC NULLS LAST,m.rank DESC,m.created_at DESC,m.source,m.id LIMIT 1
    ) r
    LEFT JOIN LATERAL (
      SELECT jsonb_object_agg(e.key,e.value ORDER BY m.rank,m.created_at,m.source,m.id) AS profile
      FROM matched m CROSS JOIN LATERAL jsonb_each(m.profile) e
      WHERE m.contact_key=p.contact_key AND e.value NOT IN ('null'::jsonb,'""'::jsonb,'{}'::jsonb)
    ) fields ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_object_agg(e.key,e.value ORDER BY m.rank,m.created_at,m.source,m.id) AS fields
      FROM matched m CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(m.custom_fields)='object' THEN m.custom_fields ELSE '{}'::jsonb END) e
      WHERE m.contact_key=p.contact_key AND e.value NOT IN ('null'::jsonb,'""'::jsonb,'{}'::jsonb)
    ) custom ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(email ORDER BY email) AS values FROM (
        SELECT DISTINCT trim(e.value #>> '{}') AS email
        FROM matched m CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(m.custom_fields)='object' THEN m.custom_fields ELSE '{}'::jsonb END) e
        WHERE m.contact_key=p.contact_key AND lower(e.key) LIKE '%mail%'
          AND jsonb_typeof(e.value)='string' AND (e.value #>> '{}') LIKE '%@%'
      ) address_list
    ) emails ON true
    LEFT JOIN public.calls c ON r.source='call' AND c.id=r.id::uuid
    LEFT JOIN public.secretary_calls s ON r.source='secretary' AND s.id=r.id::uuid
    LEFT JOIN public.agents a ON a.id=coalesce(c.agent_id,s.agent_id)
  )
  SELECT jsonb_build_object('results',coalesce(jsonb_agg(data ORDER BY last_call_time DESC NULLS LAST,created_at DESC,contact_key),'[]'::jsonb),
    'count',count(*),'total',(SELECT count(*) FROM grouped)) INTO v_result FROM result_rows;
  RETURN v_result;
END;
$function$;

-- Retain the older two-parameter contract for existing database callers.
CREATE OR REPLACE FUNCTION public.search_contacts(p_search text DEFAULT '', p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $function$
  SELECT public.search_contacts(p_search,50,p_offset);
$function$;

-- Contact data is returned through wolf-provider after verify_session succeeds.
REVOKE EXECUTE ON FUNCTION public.search_contacts(text,integer,integer) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.search_contacts(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.search_contacts(text,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.search_contacts(text,integer) TO service_role;

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
