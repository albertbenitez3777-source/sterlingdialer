create index if not exists calls_blocked_phone_normalized_idx
  on public.calls(public.normalize_phone(consumer_phone)) where is_dnc or is_wrong_number;

create or replace function public.import_leads(p_leads jsonb, p_filename text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_lead jsonb; v_import uuid; v_phone text; v_name text; v_existing uuid;
  v_inserted integer:=0; v_updated integer:=0; v_invalid integer:=0; v_blocked integer:=0; v_fields jsonb;
begin
  if jsonb_typeof(p_leads) <> 'array' or jsonb_array_length(p_leads) > 10000 then
    return jsonb_build_object('success',false,'error','Upload an array of at most 10,000 leads.');
  end if;
  perform pg_advisory_xact_lock(217, 2);
  insert into public.lead_imports(filename,total_rows,valid_rows,invalid_rows,status)
    values(left(coalesce(p_filename,'upload.csv'),255),jsonb_array_length(p_leads),0,0,'processing') returning id into v_import;
  for v_lead in select * from jsonb_array_elements(p_leads) loop
    v_name:=trim(coalesce(v_lead->>'name',v_lead->>'full_name',v_lead->>'Full Name',''));
    v_phone:=public.normalize_phone(coalesce(v_lead->>'telephone_original',v_lead->>'telephone_number',v_lead->>'Telephone Number',''));
    if v_name='' or v_phone !~ '^\+[1-9][0-9]{7,14}$' then v_invalid:=v_invalid+1; continue; end if;
    if exists(select 1 from public.calls c where public.normalize_phone(c.consumer_phone)=v_phone and (c.is_dnc or c.is_wrong_number)) then
      v_blocked:=v_blocked+1; continue;
    end if;
    v_fields:=case when jsonb_typeof(v_lead->'custom_fields')='object' then v_lead->'custom_fields' else '{}'::jsonb end;
    if nullif(trim(coalesce(v_lead->>'email',v_lead->>'Email','')),'') is not null then
      v_fields:=v_fields||jsonb_build_object('Email',trim(coalesce(v_lead->>'email',v_lead->>'Email')));
    end if;
    select id into v_existing from public.leads where public.normalize_phone(telephone_normalized)=v_phone order by created_at limit 1;
    if found then
      -- Re-uploading enriches the existing contact; it never erases opt-outs or
      -- turns a closed/contacted record into a forced redial.
      update public.leads set custom_fields=coalesce(custom_fields,'{}'::jsonb)||v_fields where id=v_existing;
      v_updated:=v_updated+1;
    else
      insert into public.leads(name,telephone_original,telephone_normalized,address,income_range,home_value,
        property_information,notes,original_agent_information,source,custom_fields,status)
      values(left(v_name,240),coalesce(v_lead->>'telephone_original',v_lead->>'telephone_number',v_lead->>'Telephone Number'),v_phone,
        coalesce(v_lead->>'address',v_lead->>'Address',''),coalesce(v_lead->>'income_range',v_lead->>'annual_income',''),
        coalesce(v_lead->>'home_value',''),coalesce(v_lead->>'property_information',''),coalesce(v_lead->>'notes',''),'',
        coalesce(nullif(v_lead->>'source',''),p_filename,'upload.csv'),v_fields,'new');
      v_inserted:=v_inserted+1;
    end if;
  end loop;
  update public.lead_imports set valid_rows=v_inserted+v_updated,invalid_rows=v_invalid+v_blocked,status='completed' where id=v_import;
  return jsonb_build_object('success',true,'imported',v_inserted,'updated',v_updated,'reopened',0,'invalid',v_invalid,'blocked',v_blocked,'import_id',v_import);
end; $$;
revoke execute on function public.import_leads(jsonb,text) from public, anon, authenticated;
grant execute on function public.import_leads(jsonb,text) to service_role;

CREATE OR REPLACE FUNCTION public.dialer_next_batch()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_campaign        record;
v_remaining       integer;
v_calls_placed    integer;
v_results         jsonb[] := ARRAY[]::jsonb[];
v_lead            record;
v_call_id         uuid;
v_agent           record;
v_agent_remaining integer;
v_active          integer;
v_phone_already_called boolean;
v_global_active   integer;
v_global_remaining integer;
v_recent_hour integer;
v_recent_minute integer;
v_james_id        uuid := 'c242abef-c01e-490b-bab6-859cd89bd08a';
BEGIN
IF NOT pg_try_advisory_xact_lock(217, 1) THEN
RETURN jsonb_build_object('success', true, 'calls', jsonb_build_array(), 'skipped', 'batch_locked');
END IF;

SELECT * INTO v_campaign FROM public.campaigns ORDER BY created_at DESC LIMIT 1;

IF v_campaign.state <> 'running' THEN
RETURN jsonb_build_object('success', false, 'error', 'Campaign is not running');
END IF;

-- 3-minute placeholder cleanup
DELETE FROM public.calls
WHERE call_direction = 'outbound'
AND (provider_call_id IS NULL OR provider_call_id = '')
AND created_at < now() - interval '3 minutes';

-- Call-limit cap
SELECT count(*) INTO v_calls_placed
FROM public.calls
WHERE created_at >= v_campaign.started_at
AND call_direction = 'outbound'
AND provider_call_id IS NOT NULL AND provider_call_id <> '';

v_remaining := v_campaign.provider_call_limit - v_calls_placed;
IF v_remaining <= 0 THEN
RETURN jsonb_build_object('success', true, 'calls_to_dial', 0, 'message', 'Call limit reached');
END IF;

SELECT count(*)::integer,
count(*) FILTER (WHERE created_at >= now()-interval '1 minute')::integer
INTO v_recent_hour, v_recent_minute
FROM public.calls
WHERE call_direction='outbound' AND created_at >= now()-interval '1 hour';

v_remaining := LEAST(v_remaining,
public.dialer_rate_allowance(v_campaign.hourly_call_target,v_recent_hour,v_recent_minute));
IF v_remaining <= 0 THEN
RETURN jsonb_build_object('success',true,'calls',jsonb_build_array(),
'calls_to_dial',0,'skipped','hourly_pacing','hourly_target',v_campaign.hourly_call_target);
END IF;

-- Global concurrency cap (hard ceiling 21)
SELECT count(*) INTO v_global_active
FROM public.calls
WHERE call_direction = 'outbound'
AND queue = 'pending'
AND is_completed = false;

v_global_remaining := LEAST(
GREATEST(LEAST(v_campaign.concurrency, 21) - v_global_active, 0),
v_remaining
);

-- ────────────────────────────────────────────────────────
-- RETRY MODE: pull from retry_leads instead of leads
-- ────────────────────────────────────────────────────────
IF v_campaign.campaign_type = 'retry' THEN
-- Reset stuck in_progress retry_leads
UPDATE public.retry_leads
SET status = 'new'
WHERE status = 'in_progress'
AND NOT EXISTS (
SELECT 1 FROM public.calls c
WHERE c.consumer_phone = retry_leads.phone_normalized
AND c.call_direction = 'outbound'
AND c.provider_call_id IS NOT NULL AND c.provider_call_id <> ''
AND c.created_at >= v_campaign.started_at
)
AND NOT EXISTS (
SELECT 1 FROM public.calls p
WHERE p.consumer_phone = retry_leads.phone_normalized
AND p.call_direction = 'outbound'
AND p.created_at >= now() - interval '3 minutes'
);

FOR v_agent IN
SELECT * FROM public.agents a
WHERE a.active_for_dialer = true
AND a.status = 'active'
AND a.is_owner = false
AND a.available_for_transfer = true
AND a.transfer_certified = true
AND a.bland_number IS NOT NULL AND a.bland_number <> ''
AND a.talkroute_number IS NOT NULL AND a.talkroute_number <> ''
ORDER BY (
SELECT count(*) FROM public.calls c
WHERE c.agent_id = a.id AND c.created_at >= v_campaign.started_at
), a.created_at
LOOP
IF v_global_remaining <= 0 OR v_remaining <= 0 THEN EXIT; END IF;

SELECT count(*) INTO v_active
FROM public.calls
WHERE agent_id = v_agent.id AND queue = 'pending' AND is_completed = false;

v_agent_remaining := LEAST(
GREATEST(LEAST(COALESCE(v_agent.dialer_concurrency,3),7) - v_active, 0),
v_global_remaining, v_remaining
);
IF v_agent_remaining <= 0 THEN CONTINUE; END IF;

FOR v_lead IN
SELECT rl.id, rl.phone_normalized, rl.consumer_name, rl.address,
rl.income_range, rl.home_value, rl.property_information, rl.custom_fields
FROM public.retry_leads rl
WHERE rl.status = 'new'
AND rl.exclusion_reason IS NULL
AND NOT EXISTS (SELECT 1 FROM public.calls blocked WHERE public.normalize_phone(blocked.consumer_phone)=public.normalize_phone(rl.phone_normalized) AND (blocked.is_dnc OR blocked.is_wrong_number))
AND NOT EXISTS (
SELECT 1 FROM public.calls c
WHERE c.consumer_phone = rl.phone_normalized
AND c.call_direction = 'outbound'
AND c.provider_call_id IS NOT NULL AND c.provider_call_id <> ''
AND c.created_at >= v_campaign.started_at
)
ORDER BY rl.last_human_at DESC NULLS LAST
FOR UPDATE OF rl SKIP LOCKED
LIMIT v_agent_remaining
LOOP
UPDATE public.retry_leads SET status = 'in_progress', dialed_at = now() WHERE id = v_lead.id;

BEGIN
INSERT INTO public.calls (
lead_id, agent_id, provider, queue, call_direction,
consumer_name, consumer_phone, consumer_address,
consumer_home_value, consumer_income_range, consumer_property_info,
consumer_custom_fields
) VALUES (
NULL, v_agent.id, 'bland.ai', 'pending', 'outbound',
v_lead.consumer_name, v_lead.phone_normalized, v_lead.address,
v_lead.home_value, v_lead.income_range, v_lead.property_information,
COALESCE(v_lead.custom_fields, '{}'::jsonb)
)
RETURNING id INTO v_call_id;

v_results := array_append(v_results, jsonb_build_object(
'call_id', v_call_id, 'retry_lead_id', v_lead.id,
'phone', v_lead.phone_normalized, 'name', v_lead.consumer_name,
'agent_id', v_agent.id, 'agent_name', v_agent.full_name,
'bland_number', v_agent.bland_number, 'bland_phone_id', v_agent.bland_phone_id,
'bland_voice_id', v_agent.bland_voice_id, 'talkroute_number', v_agent.talkroute_number
));

v_remaining := v_remaining - 1;
v_global_remaining := v_global_remaining - 1;
EXCEPTION WHEN unique_violation THEN
UPDATE public.retry_leads SET status = 'closed' WHERE id = v_lead.id;
END;
END LOOP;
END LOOP;

RETURN jsonb_build_object(
'success', true,
'calls_to_dial', jsonb_array_length(to_jsonb(v_results)),
'calls', to_jsonb(v_results),
'mode', 'retry'
);
END IF;

-- ────────────────────────────────────────────────────────
-- STANDARD MODE with AGENT-LEAD ROUTING
-- James Spencer gets email_batch_20 leads only.
-- All other agents get non-email leads only.
-- ────────────────────────────────────────────────────────

-- Reset stuck leads
UPDATE public.leads
SET status = 'new'
WHERE status = 'in_progress'
AND NOT EXISTS (
SELECT 1 FROM public.calls c
WHERE c.lead_id = leads.id AND c.call_direction = 'outbound'
AND c.provider_call_id IS NOT NULL AND c.provider_call_id <> ''
)
AND NOT EXISTS (
SELECT 1 FROM public.calls p
WHERE p.lead_id = leads.id AND p.call_direction = 'outbound'
AND p.created_at >= now() - interval '3 minutes'
);

-- Close leads already dialed (but NOT force_redial leads)
UPDATE public.leads SET status = 'closed'
WHERE status IN ('new','in_progress')
AND telephone_normalized <> ''
AND force_redial IS NOT TRUE
AND EXISTS (
SELECT 1 FROM public.calls c
WHERE c.consumer_phone = leads.telephone_normalized
AND c.call_direction = 'outbound'
AND c.provider_call_id IS NOT NULL AND c.provider_call_id <> ''
);

FOR v_agent IN
SELECT * FROM public.agents a
WHERE a.active_for_dialer = true
AND a.status = 'active'
AND a.is_owner = false
AND a.available_for_transfer = true
AND a.transfer_certified = true
AND a.bland_number IS NOT NULL AND a.bland_number <> ''
AND a.talkroute_number IS NOT NULL AND a.talkroute_number <> ''
ORDER BY (
SELECT count(*) FROM public.calls c
WHERE c.agent_id = a.id AND c.created_at >= v_campaign.started_at
), a.created_at
LOOP
IF v_global_remaining <= 0 OR v_remaining <= 0 THEN EXIT; END IF;

SELECT count(*) INTO v_active
FROM public.calls
WHERE agent_id = v_agent.id AND queue = 'pending' AND is_completed = false;

v_agent_remaining := LEAST(
GREATEST(LEAST(COALESCE(v_agent.dialer_concurrency,3),7) - v_active, 0),
v_global_remaining, v_remaining
);
IF v_agent_remaining <= 0 THEN CONTINUE; END IF;

FOR v_lead IN
SELECT l.id, l.name, l.telephone_original, l.telephone_normalized,
l.address, l.income_range, l.home_value, l.property_information,
l.notes, l.source, l.custom_fields, l.retry_count, l.next_eligible_at,
l.force_redial
FROM public.leads l
WHERE l.status = 'new'
AND NOT EXISTS (SELECT 1 FROM public.calls blocked WHERE public.normalize_phone(blocked.consumer_phone)=public.normalize_phone(l.telephone_normalized) AND (blocked.is_dnc OR blocked.is_wrong_number))
AND l.telephone_normalized <> ''
AND (l.next_eligible_at IS NULL OR l.next_eligible_at <= now())
-- AGENT-LEAD ROUTING: James gets email leads, others get non-email leads
AND CASE
WHEN v_agent.id = v_james_id THEN l.source = 'email_batch_20'
ELSE l.source <> 'email_batch_20'
END
AND (
l.force_redial = true
OR NOT EXISTS (
SELECT 1 FROM public.calls c
WHERE c.consumer_phone = l.telephone_normalized
AND c.call_direction = 'outbound'
AND c.provider_call_id IS NOT NULL AND c.provider_call_id <> ''
)
)
ORDER BY l.created_at ASC
FOR UPDATE OF l SKIP LOCKED
LIMIT v_agent_remaining
LOOP
IF v_lead.force_redial IS NOT TRUE THEN
SELECT EXISTS(
SELECT 1 FROM public.calls c
WHERE c.consumer_phone = v_lead.telephone_normalized
AND c.call_direction = 'outbound'
AND c.provider_call_id IS NOT NULL AND c.provider_call_id <> ''
) INTO v_phone_already_called;

IF v_phone_already_called THEN
UPDATE public.leads SET status = 'closed' WHERE id = v_lead.id;
CONTINUE;
END IF;
END IF;

UPDATE public.leads SET status = 'in_progress', force_redial = false WHERE id = v_lead.id;

BEGIN
INSERT INTO public.calls (
lead_id, agent_id, provider, queue, call_direction,
consumer_name, consumer_phone, consumer_address,
consumer_home_value, consumer_income_range, consumer_property_info,
consumer_custom_fields
) VALUES (
v_lead.id, v_agent.id, 'bland.ai', 'pending', 'outbound',
v_lead.name, v_lead.telephone_normalized, v_lead.address,
v_lead.home_value, v_lead.income_range, v_lead.property_information,
COALESCE(v_lead.custom_fields, '{}'::jsonb)
)
RETURNING id INTO v_call_id;

v_results := array_append(v_results, jsonb_build_object(
'call_id', v_call_id, 'lead_id', v_lead.id,
'phone', v_lead.telephone_normalized, 'name', v_lead.name,
'agent_id', v_agent.id, 'agent_name', v_agent.full_name,
'bland_number', v_agent.bland_number, 'bland_phone_id', v_agent.bland_phone_id,
'bland_voice_id', v_agent.bland_voice_id, 'talkroute_number', v_agent.talkroute_number,
'agent_direct_number', v_agent.agent_direct_number
));

v_remaining := v_remaining - 1;
v_global_remaining := v_global_remaining - 1;
EXCEPTION WHEN unique_violation THEN
UPDATE public.leads SET status = 'closed' WHERE id = v_lead.id;
END;
END LOOP;
END LOOP;

RETURN jsonb_build_object(
'success', true,
'calls_to_dial', jsonb_array_length(to_jsonb(v_results)),
'calls', to_jsonb(v_results)
);
END;
$function$
;
