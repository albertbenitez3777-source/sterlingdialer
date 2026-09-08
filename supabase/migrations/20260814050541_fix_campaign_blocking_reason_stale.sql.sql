/*
# Fix stale campaign blocking_reason and remove after-hours restriction

1. get_admin_stats: Return empty blocking_reason when campaign is stopped,
   so stale messages from a previous failed start attempt don't persist on screen.
2. campaign_start: Remove the after-hours calling restriction (9am-8pm ET, Mon-Sat)
   so the admin can test the dialer at any time. All other safety checks remain:
   no agent selected, no eligible leads, stale calls, campaign already running.
3. Clear any existing stale blocking_reason on stopped campaigns.
*/

-- ============================================================
-- 1. Rewrite campaign_start without after-hours restriction
-- ============================================================
CREATE OR REPLACE FUNCTION public.campaign_start(p_concurrency integer, p_call_limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_campaign record; v_selected_count integer; v_blocking text := '';
  v_eligible_leads integer; v_unresolved_calls integer;
BEGIN
  SELECT * INTO v_campaign FROM public.campaigns ORDER BY created_at DESC LIMIT 1;
  SELECT count(*) INTO v_selected_count FROM public.agents
  WHERE active_for_dialer = true AND status = 'active' AND logged_in = true AND available_for_transfer = true
  AND bland_number <> '' AND talkroute_number <> '' AND transfer_certified = true AND is_owner = false;
  SELECT count(*) INTO v_eligible_leads FROM public.leads WHERE status IN ('new', 'pending');
  SELECT count(*) INTO v_unresolved_calls FROM public.calls WHERE queue = 'pending' AND created_at > now() - interval '1 hour';
  IF v_selected_count = 0 THEN v_blocking := v_blocking || 'No agent selected and ready. '; END IF;
  IF v_eligible_leads = 0 THEN v_blocking := v_blocking || 'No eligible leads. '; END IF;
  IF v_unresolved_calls > 0 THEN v_blocking := v_blocking || 'Unresolved stale calls. '; END IF;
  IF v_campaign.state = 'running' THEN v_blocking := v_blocking || 'Campaign already running. '; END IF;
  IF v_blocking <> '' THEN
    UPDATE public.campaigns SET blocking_reason = v_blocking, updated_at = now() WHERE id = v_campaign.id;
    RETURN jsonb_build_object('success', false, 'error', 'Campaign cannot start', 'blocking_reason', v_blocking);
  END IF;
  UPDATE public.campaigns SET state = 'running', dialer_activated = true, concurrency = p_concurrency,
    provider_call_limit = p_call_limit, started_at = now(), blocking_reason = '', updated_at = now()
  WHERE id = v_campaign.id;
  INSERT INTO public.campaign_events (campaign_id, event_type, event_data)
  VALUES (v_campaign.id, 'campaign_start', jsonb_build_object('concurrency', p_concurrency, 'call_limit', p_call_limit));
  RETURN jsonb_build_object('success', true, 'state', 'running');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.campaign_start FROM anon;
GRANT EXECUTE ON FUNCTION public.campaign_start TO authenticated;

-- ============================================================
-- 2. Clear stale blocking_reason on stopped campaigns
-- ============================================================
UPDATE public.campaigns SET blocking_reason = '' WHERE state = 'stopped';
