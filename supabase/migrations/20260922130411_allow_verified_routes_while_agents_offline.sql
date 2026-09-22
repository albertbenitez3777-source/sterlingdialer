-- Normal campaigns may reach each verified agent route while the desktop is offline.
-- PBX no-answer voicemail remains the fallback. No fake phone presence is recorded.
CREATE OR REPLACE FUNCTION public.agent_dialer_route_ready(p_agent_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT EXISTS (
 SELECT 1 FROM public.agents a
 WHERE a.id=p_agent_id AND a.status='active' AND NOT a.is_owner
 AND a.active_for_dialer AND a.available_for_transfer AND a.transfer_certified
 AND a.inbound_configured AND a.mapping_verified AND a.provider_sync_status='synced'
 AND regexp_replace(coalesce(a.bland_number,''),'[^0-9]','','g') ~ '^[1-9][0-9]{7,14}$'
 AND regexp_replace(coalesce(a.talkroute_number,''),'[^0-9]','','g') ~ '^[1-9][0-9]{7,14}$'
 AND nullif(a.zadarma_sip_login,'') IS NOT NULL
 );
$$;
REVOKE ALL ON FUNCTION public.agent_dialer_route_ready(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.agent_dialer_route_ready(uuid) TO service_role;
COMMENT ON FUNCTION public.agent_dialer_route_ready(uuid) IS 'Campaign eligibility uses the verified assigned phone route. Desktop presence remains status only; unanswered transfers follow PBX voicemail.';

CREATE OR REPLACE FUNCTION public.campaign_agent_can_receive(p_agent_id uuid, p_campaign_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
 SELECT EXISTS (
 SELECT 1 FROM public.agents a JOIN public.campaigns c ON c.id=p_campaign_id
 WHERE a.id=p_agent_id AND a.status='active' AND NOT a.is_owner
 AND a.active_for_dialer AND a.available_for_transfer AND a.transfer_certified
 AND public.agent_dialer_route_ready(a.id)
 AND CASE WHEN c.offline_voicemail_test_until IS NOT NULL THEN
 c.offline_voicemail_test_until>now()
 AND c.started_at>=now()-interval '30 minutes'
 AND c.provider_call_limit BETWEEN 1 AND 20
 AND a.id=ANY(c.offline_voicemail_test_agents)
 ELSE true END
 );
$function$;

CREATE OR REPLACE FUNCTION public.count_available_agents()
RETURNS integer LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT count(*)::integer FROM public.agents a WHERE public.agent_dialer_route_ready(a.id);
$$;

CREATE OR REPLACE FUNCTION public.campaign_start(p_concurrency integer DEFAULT 3, p_call_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
DECLARE
v_campaign record;
v_selected_count integer;
v_blocking text := '';
v_eligible_leads integer;
v_cleaned_count integer;
BEGIN
IF public.count_available_agents() = 0 THEN
 RETURN jsonb_build_object('success',false,'error','No verified agent routes selected','blocking_reason','Select an active agent with a verified Bland number and Zadarma destination. Desktop connection is not required.');
END IF;
IF p_concurrency NOT IN (3,6,9,12) OR p_concurrency IS NULL OR p_call_limit IS NULL OR p_call_limit<=0 THEN
 RETURN jsonb_build_object('success',false,'error','Choose speed 1x-4x and a positive call limit.');
END IF;
SELECT * INTO v_campaign FROM public.campaigns ORDER BY created_at DESC LIMIT 1 FOR UPDATE;

-- Provider-accepted calls remain pending until a webhook or backfill confirms
-- completion. Preserve the legacy response field without inventing outcomes.
v_cleaned_count := 0;

UPDATE public.leads
SET status = 'new'
WHERE status = 'in_progress'
AND id IN (
SELECT DISTINCT c.lead_id FROM public.calls c
WHERE c.queue <> 'pending' AND c.lead_id IS NOT NULL
);

SELECT count(*) INTO v_selected_count FROM public.agents a
WHERE a.active_for_dialer = true
AND a.status = 'active'
AND a.is_owner = false
AND a.transfer_certified = true
AND a.bland_number IS NOT NULL AND a.bland_number <> ''
AND a.talkroute_number IS NOT NULL AND a.talkroute_number <> '';

SELECT count(*) INTO v_eligible_leads FROM public.leads WHERE status = 'new';

IF v_selected_count = 0 THEN v_blocking := v_blocking || 'No agents available (must be selected, active and transfer-certified with valid phone numbers). '; END IF;
IF v_eligible_leads = 0 THEN v_blocking := v_blocking || 'No leads uploaded. '; END IF;
IF v_campaign.state = 'running' THEN v_blocking := v_blocking || 'Campaign already running. '; END IF;

IF v_blocking <> '' THEN
UPDATE public.campaigns SET blocking_reason = v_blocking, updated_at = now() WHERE id = v_campaign.id;
RETURN jsonb_build_object('success', false, 'error', 'Campaign cannot start', 'blocking_reason', v_blocking);
END IF;

UPDATE public.campaigns
SET state = 'running', dialer_status = 'dialing', dialer_activated = true, concurrency = p_concurrency,
offline_voicemail_test_until = NULL, offline_voicemail_test_agents = '{}'::uuid[], provider_call_limit = p_call_limit, started_at = now(), blocking_reason = '', updated_at = now()
WHERE id = v_campaign.id;

INSERT INTO public.campaign_events (campaign_id, event_type, event_data)
VALUES (v_campaign.id, 'campaign_start', jsonb_build_object('concurrency', p_concurrency, 'call_limit', p_call_limit, 'stale_cleaned', v_cleaned_count));

RETURN jsonb_build_object('success', true, 'message', 'Campaign started', 'stale_cleaned', v_cleaned_count);
END;
$function$;

CREATE OR REPLACE FUNCTION public.campaign_resume()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
IF public.count_available_agents() = 0 THEN
 RETURN jsonb_build_object('success',false,'error','No verified agent routes selected','blocking_reason','Select an active agent with a verified Bland number and Zadarma destination. Desktop connection is not required.');
END IF;
SELECT id INTO v_id FROM public.campaigns ORDER BY created_at DESC LIMIT 1;
UPDATE public.campaigns SET state = 'running', dialer_status = 'dialing', dialer_activated = true, updated_at = now() WHERE id = v_id;
INSERT INTO public.campaign_events (campaign_id, event_type, event_data) VALUES (v_id, 'campaign_resume', '{}'::jsonb);
RETURN jsonb_build_object('success', true, 'state', 'running');
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_dialer_ready_agents()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'full_name',a.full_name,
 'bland_number',a.bland_number,'bland_phone_id',a.bland_phone_id,'bland_voice_id',a.bland_voice_id,
 'phone_ready',public.agent_phone_ready(a.id),'dialer_route_ready',true) ORDER BY a.full_name),'[]'::jsonb)
 FROM public.agents a WHERE public.agent_dialer_route_ready(a.id);
$$;

REVOKE ALL ON FUNCTION public.campaign_agent_can_receive(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_agent_can_receive(uuid,uuid) TO service_role;

REVOKE ALL ON FUNCTION public.count_available_agents() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.count_available_agents() TO service_role;

REVOKE ALL ON FUNCTION public.campaign_start(integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_start(integer,integer) TO service_role;

REVOKE ALL ON FUNCTION public.campaign_resume() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_resume() TO service_role;

REVOKE ALL ON FUNCTION public.get_dialer_ready_agents() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_dialer_ready_agents() TO service_role;


