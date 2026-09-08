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
  v_pattern text;
BEGIN
  IF v_term='' THEN RETURN jsonb_build_object('results','[]'::jsonb,'count',0,'total',0); END IF;
  v_norm := regexp_replace(v_term,'[[:space:],.]+',' ','g');
  v_digits := right(regexp_replace(v_term,'[^0-9]','','g'),10);
  v_phone_search := v_term ~ '^[+0-9() .-]+$' AND length(v_digits)>=3;

  v_pattern := '%'||CASE WHEN v_phone_search THEN v_digits ELSE replace(replace(replace(v_norm,chr(92),chr(92)||chr(92)),'%',chr(92)||'%'),'_',chr(92)||'_') END||'%';

  WITH matching(source,id,canon) AS MATERIALIZED (
    SELECT 'lead',l.id::text,public.phone_last10(coalesce(nullif(l.telephone_normalized,''),l.telephone_original)) FROM public.leads l
    WHERE regexp_replace(lower(coalesce(l.name,'')||' '||coalesce(l.address,'')||' '||coalesce(l.income_range,'')||' '||coalesce(l.home_value,'')||' '||coalesce(l.property_information,'')||' '||coalesce(l.notes,'')||' '||coalesce(l.original_agent_information,'')||' '||coalesce(l.source,'')||' '||coalesce(l.custom_fields::text,'')||' '||public.phone_last10(coalesce(nullif(l.telephone_normalized,''),l.telephone_original))),'[[:space:],.]+',' ','g') LIKE v_pattern
    UNION ALL
    SELECT 'call',c.id::text,public.phone_last10(coalesce(nullif(c.consumer_phone,''),CASE WHEN c.call_direction='inbound' THEN c.from_number ELSE c.to_number END)) FROM public.calls c
    WHERE regexp_replace(lower(coalesce(c.consumer_name,'')||' '||coalesce(c.consumer_address,'')||' '||coalesce(c.consumer_income_range,'')||' '||coalesce(c.consumer_home_value,'')||' '||coalesce(c.consumer_property_info,'')||' '||coalesce(c.agent_notes,'')||' '||coalesce(c.consumer_custom_fields::text,'')||' '||public.phone_last10(coalesce(nullif(c.consumer_phone,''),CASE WHEN c.call_direction='inbound' THEN c.from_number ELSE c.to_number END))),'[[:space:],.]+',' ','g') LIKE v_pattern
    UNION ALL
    SELECT 'retry',r.id::text,public.phone_last10(r.phone_normalized) FROM public.retry_leads r
    WHERE regexp_replace(lower(coalesce(r.consumer_name,'')||' '||coalesce(r.address,'')||' '||coalesce(r.income_range,'')||' '||coalesce(r.home_value,'')||' '||coalesce(r.property_information,'')||' '||coalesce(r.custom_fields::text,'')||' '||public.phone_last10(r.phone_normalized)),'[[:space:],.]+',' ','g') LIKE v_pattern
    UNION ALL
    SELECT 'transfer',t.id::text,public.phone_last10(t.phone_normalized) FROM public.transfer_context t
    WHERE regexp_replace(lower(coalesce(t.consumer_name,'')||' '||coalesce(t.consumer_address,'')||' '||coalesce(t.consumer_income_range,'')||' '||coalesce(t.consumer_home_value,'')||' '||coalesce(t.consumer_property_info,'')||' '||coalesce(t.notes,'')||' '||coalesce(t.consumer_custom_fields::text,'')||' '||public.phone_last10(t.phone_normalized)),'[[:space:],.]+',' ','g') LIKE v_pattern
    UNION ALL
    SELECT 'secretary',s.id::text,public.phone_last10(s.client_phone) FROM public.secretary_calls s
    WHERE regexp_replace(lower(coalesce(s.client_name,'')||' '||coalesce(s.custom_message,'')||' '||public.phone_last10(s.client_phone)),'[[:space:],.]+',' ','g') LIKE v_pattern
    UNION ALL
    SELECT 'saved_transfer',s.id::text,public.phone_last10(s.consumer_phone) FROM public.saved_transfers s
    WHERE regexp_replace(lower(coalesce(s.consumer_name,'')||' '||coalesce(s.consumer_address,'')||' '||coalesce(s.consumer_income_range,'')||' '||coalesce(s.consumer_home_value,'')||' '||coalesce(s.consumer_property_info,'')||' '||coalesce(s.notes,'')||' '||public.phone_last10(s.consumer_phone)),'[[:space:],.]+',' ','g') LIKE v_pattern
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
