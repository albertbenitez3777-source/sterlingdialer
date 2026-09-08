/*
# Owner Administrator + Complete Agent Roster + Campaign Tables

## Summary
1. Adds `visible_in_admin`, `is_owner`, `secretary_persona` columns to agents table
2. Creates Owner Administrator account (separate from all agents, no phone mappings)
3. Converts James Spencer from administrator → agent
4. Updates all agent phone mappings to production values
5. Creates Mark Carlson (disabled, no PIN)
6. Creates William Styles (fired, archived, hidden)
7. Creates Dave Sayer (inactive, archived, historical)
8. Creates `campaigns` table for campaign state management
9. Creates `campaign_events` table for provider event tracking
10. Creates `lead_imports` table for CSV/Excel lead import tracking
11. Removes global caller-ID fallback from app_settings
12. Updates get_admin_stats to include campaign state, leads remaining, and new agent fields
13. Adds campaign management functions (start/pause/resume/stop)
14. Adds lead import function, lead pool stats, audit logs, campaign events
15. Adds owner setup, agent status, dialer selection functions
*/

-- ============================================================
-- 1. Add new columns to agents table
-- ============================================================
DO $$ BEGIN
  ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS visible_in_admin boolean NOT NULL DEFAULT true;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS is_owner boolean NOT NULL DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS secretary_persona text NOT NULL DEFAULT '';
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- ============================================================
-- 2. Create campaigns table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state text NOT NULL DEFAULT 'stopped',
  dialer_activated boolean NOT NULL DEFAULT false,
  concurrency integer NOT NULL DEFAULT 3,
  provider_call_limit integer NOT NULL DEFAULT 0,
  provider_accepted_completed integer NOT NULL DEFAULT 0,
  active_calls integer NOT NULL DEFAULT 0,
  started_at timestamptz,
  last_provider_event timestamptz,
  blocking_reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3. Create campaign_events table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.campaign_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  event_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.campaign_events ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 4. Create lead_imports table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.lead_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text NOT NULL DEFAULT '',
  total_rows integer NOT NULL DEFAULT 0,
  valid_rows integer NOT NULL DEFAULT 0,
  invalid_rows integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lead_imports ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 5. Remove global caller-ID fallback
-- ============================================================
DELETE FROM public.app_settings WHERE key = 'global_caller_id';
DELETE FROM public.app_settings WHERE key = 'default_bland_number';

-- ============================================================
-- 6. Create Owner Administrator account (no PIN yet)
-- ============================================================
INSERT INTO public.agents (full_name, email, role, status, is_owner, visible_in_admin, bland_number, talkroute_number, bland_voice_id, secretary_persona, active_for_dialer, logged_in, available_for_transfer)
SELECT 'Owner Administrator', 'owner@wolfdialer.local', 'owner', 'active', true, false, '', '', '', '', false, false, false
WHERE NOT EXISTS (SELECT 1 FROM public.agents WHERE is_owner = true);

-- ============================================================
-- 7. Convert James Spencer to agent + update mappings
-- ============================================================
UPDATE public.agents SET
  role = 'agent',
  bland_number = '+1 (771) 202-6103',
  talkroute_number = '+1 (800) 403-1524',
  bland_voice_id = '29158307-9893-4149-8a75-bc9ce313d64e',
  secretary_persona = 'Elizabeth Sterling',
  is_owner = false,
  visible_in_admin = true
WHERE full_name = 'James Spencer';

-- ============================================================
-- 8. Update John McCarthy
-- ============================================================
UPDATE public.agents SET
  bland_voice_id = '29158307-9893-4149-8a75-bc9ce313d64e',
  secretary_persona = 'Elizabeth Sterling',
  visible_in_admin = true
WHERE full_name = 'John McCarthy';

-- ============================================================
-- 9. Update Erick Jackson with full production mapping
-- ============================================================
UPDATE public.agents SET
  bland_number = '+1 (315) 756-6825',
  talkroute_number = '+1 (800) 490-7196',
  bland_voice_id = '29158307-9893-4149-8a75-bc9ce313d64e',
  secretary_persona = 'Elizabeth Sterling',
  historical_number = '+1 (202) 929-6629',
  historical_number_status = 'replaced_by_production_mapping',
  mapping_notes = 'Historical number +1 (202) 929-6629 replaced by production mapping +1 (315) 756-6825.',
  visible_in_admin = true,
  active_for_dialer = false
WHERE full_name = 'Erick Jackson';

-- ============================================================
-- 10. Update Matt Vargas with correct production mapping
-- ============================================================
UPDATE public.agents SET
  bland_number = '+1 (202) 471-1840',
  talkroute_number = '+1 (800) 474-1038',
  bland_voice_id = '29158307-9893-4149-8a75-bc9ce313d64e',
  secretary_persona = 'Elizabeth Sterling',
  historical_number = '+1 (202) 883-5846',
  historical_number_status = 'replaced_by_production_mapping',
  mapping_notes = 'Historical number +1 (202) 883-5846 replaced by production mapping +1 (202) 471-1840.',
  visible_in_admin = true,
  active_for_dialer = false
WHERE full_name = 'Matt Vargas';

-- ============================================================
-- 11. Create Mark Carlson (disabled, no PIN)
-- ============================================================
INSERT INTO public.agents (full_name, email, role, status, bland_number, talkroute_number, bland_voice_id, secretary_persona, visible_in_admin, active_for_dialer, logged_in, available_for_transfer, mapping_notes)
SELECT 'Mark Carlson', 'mark.carlson@wolfdialer.local', 'agent', 'disabled',
  '+1 (917) 746-0418', '+1 (800) 967-3308',
  '29158307-9893-4149-8a75-bc9ce313d64e', 'Elizabeth Sterling',
  true, false, false, false,
  'Talkroute phone was empty in old database. Production assigned number and direct line both confirm +1 (800) 967-3308.'
WHERE NOT EXISTS (SELECT 1 FROM public.agents WHERE full_name = 'Mark Carlson');

-- ============================================================
-- 12. Create William Styles (fired, archived)
-- ============================================================
INSERT INTO public.agents (full_name, email, role, status, bland_number, talkroute_number, bland_voice_id, secretary_persona, visible_in_admin, active_for_dialer, logged_in, available_for_transfer, historical_number, historical_number_status, mapping_notes)
SELECT 'William Styles', 'william.styles@wolfdialer.local', 'agent', 'archived',
  '+1 (301) 298-3442', '+1 (202) 900-3802',
  '29158307-9893-4149-8a75-bc9ce313d64e', 'Elizabeth Sterling',
  true, false, false, false,
  '+1 (301) 298-3442', 'historical_naming_conflict',
  'Fired. Old Bland line labeled "Jason Taylor" but pinned to William Styles. Do not assign to any active agent.'
WHERE NOT EXISTS (SELECT 1 FROM public.agents WHERE full_name = 'William Styles');

-- ============================================================
-- 13. Create Dave Sayer (inactive, archived)
-- ============================================================
INSERT INTO public.agents (full_name, email, role, status, bland_number, talkroute_number, bland_voice_id, secretary_persona, visible_in_admin, active_for_dialer, logged_in, available_for_transfer, historical_number, historical_number_status, mapping_notes)
SELECT 'Dave Sayer', 'dave.sayer@wolfdialer.local', 'agent', 'archived',
  '', '+1 (877) 841-7791',
  '29158307-9893-4149-8a75-bc9ce313d64e', 'Elizabeth Sterling',
  true, false, false, false,
  '', 'historical_talkroute_conflict',
  'Inactive closer. No Bland.ai number. Conflicting Talkroute: assigned +1 (877) 841-7791, direct line +1 (800) 754-4309.'
WHERE NOT EXISTS (SELECT 1 FROM public.agents WHERE full_name = 'Dave Sayer');

-- ============================================================
-- 14. Ensure all agents deselected from Dialer
-- ============================================================
UPDATE public.agents SET active_for_dialer = false WHERE is_owner = false;

-- ============================================================
-- 15. Create initial campaign record (stopped)
-- ============================================================
INSERT INTO public.campaigns (state, dialer_activated, concurrency, provider_call_limit, blocking_reason)
SELECT 'stopped', false, 3, 0, 'No agents selected for Dialer'
WHERE NOT EXISTS (SELECT 1 FROM public.campaigns);

-- ============================================================
-- 16. normalize_phone helper
-- ============================================================
CREATE OR REPLACE FUNCTION public.normalize_phone(p_phone text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE v_digits text;
BEGIN
  v_digits := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
  IF length(v_digits) = 11 AND v_digits LIKE '1%' THEN
    v_digits := substring(v_digits, 2);
  END IF;
  IF length(v_digits) = 10 THEN
    RETURN '+1' || v_digits;
  END IF;
  RETURN '+' || v_digits;
END;
$$;

-- ============================================================
-- 17. get_admin_stats with campaign + new fields
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_admin_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_summary jsonb;
  v_agents jsonb;
  v_agent record;
  v_durations jsonb;
  v_stats jsonb;
  v_agents_list jsonb[];
  v_campaign record;
  v_leads_remaining integer;
  v_agents_selected integer;
  v_agents_dialing integer;
BEGIN
  SELECT * INTO v_campaign FROM public.campaigns ORDER BY created_at DESC LIMIT 1;
  SELECT count(*) INTO v_leads_remaining FROM public.leads WHERE status IN ('new', 'pending');
  SELECT count(*) INTO v_agents_selected FROM public.agents WHERE active_for_dialer = true AND status = 'active' AND is_owner = false;
  SELECT count(*) INTO v_agents_dialing FROM public.agents WHERE active_for_dialer = true AND logged_in = true AND status = 'active' AND is_owner = false;

  SELECT jsonb_build_object(
    'agents_logged_in', (SELECT count(*) FROM public.agents WHERE logged_in = true AND is_owner = false AND status <> 'archived'),
    'agents_available', (SELECT count(*) FROM public.agents WHERE available_for_transfer = true AND is_owner = false AND status <> 'archived'),
    'agents_selected_for_dialer', v_agents_selected,
    'agents_dialing', v_agents_dialing,
    'leads_remaining', v_leads_remaining,
    'live_humans_today', (SELECT count(*) FROM public.calls WHERE is_live_human = true AND created_at >= date_trunc('day', now())),
    'human_drops_today', (SELECT count(*) FROM public.calls WHERE queue = 'human_drop' AND created_at >= date_trunc('day', now())),
    'fire_transfers_today', (SELECT count(*) FROM public.calls WHERE queue = 'fire_transfer' AND created_at >= date_trunc('day', now())),
    'failed_transfers_today', (SELECT count(*) FROM public.calls WHERE queue = 'human_drop' AND transfer_failure_reason <> '' AND created_at >= date_trunc('day', now())),
    'voice_messages_today', (SELECT count(*) FROM public.calls WHERE queue = 'voice_message' AND created_at >= date_trunc('day', now())),
    'calls_attempted_today', (SELECT count(*) FROM public.calls WHERE call_direction = 'outbound' AND created_at >= date_trunc('day', now())),
    'provider_accepted_today', (SELECT count(*) FROM public.calls WHERE talkroute_leg_created = true AND created_at >= date_trunc('day', now())),
    'transfer_requests_today', (SELECT count(*) FROM public.calls WHERE human_agreed_transfer = true AND created_at >= date_trunc('day', now())),
    'talkroute_answers_today', (SELECT count(*) FROM public.calls WHERE talkroute_answered = true AND created_at >= date_trunc('day', now())),
    'dnc_requests_today', (SELECT count(*) FROM public.calls WHERE is_dnc = true AND created_at >= date_trunc('day', now())),
    'callbacks_today', (SELECT count(*) FROM public.calls WHERE callback_requested = true AND created_at >= date_trunc('day', now())),
    'total_login_hours_today', (
      SELECT COALESCE(sum(extract(epoch FROM (
        LEAST(COALESCE(invalidated_at, now()), date_trunc('day', now()) + interval '1 day')
        - GREATEST(created_at, date_trunc('day', now()))
      ))), 0) / 3600
      FROM public.auth_sessions
      WHERE created_at < date_trunc('day', now()) + interval '1 day'
      AND COALESCE(invalidated_at, now()) > date_trunc('day', now())
    ),
    'campaign_state', COALESCE(v_campaign.state, 'stopped'),
    'dialer_activated', COALESCE(v_campaign.dialer_activated, false),
    'concurrency', COALESCE(v_campaign.concurrency, 3),
    'provider_call_limit', COALESCE(v_campaign.provider_call_limit, 0),
    'provider_accepted_completed', COALESCE(v_campaign.provider_accepted_completed, 0),
    'active_calls', COALESCE(v_campaign.active_calls, 0),
    'campaign_started_at', v_campaign.started_at,
    'last_provider_event', v_campaign.last_provider_event,
    'blocking_reason', COALESCE(v_campaign.blocking_reason, '')
  ) INTO v_summary;

  v_agents_list := ARRAY[]::jsonb[];
  FOR v_agent IN SELECT * FROM public.agents WHERE is_owner = false ORDER BY created_at LOOP
    SELECT public.get_agent_session_durations(v_agent.id) INTO v_durations;
    SELECT jsonb_build_object(
      'id', v_agent.id, 'full_name', v_agent.full_name, 'role', v_agent.role, 'status', v_agent.status,
      'logged_in', v_agent.logged_in, 'available', v_agent.available_for_transfer,
      'active_for_dialer', v_agent.active_for_dialer, 'visible_in_admin', v_agent.visible_in_admin,
      'bland_number', v_agent.bland_number, 'talkroute_number', v_agent.talkroute_number,
      'talkroute_extension', v_agent.talkroute_extension, 'bland_voice_id', v_agent.bland_voice_id,
      'bland_verified', v_agent.bland_verified, 'talkroute_verified', v_agent.talkroute_verified,
      'transfer_certified', v_agent.transfer_certified, 'provider_sync_status', v_agent.provider_sync_status,
      'bland_number_owned_active', v_agent.bland_number_owned_active, 'mapping_notes', v_agent.mapping_notes,
      'exact_blocker', v_agent.exact_blocker, 'secretary_persona', v_agent.secretary_persona,
      'outbound_attempts_today', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND call_direction = 'outbound' AND created_at >= date_trunc('day', now())),
      'provider_accepted', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND talkroute_leg_created = true AND created_at >= date_trunc('day', now())),
      'live_humans', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND is_live_human = true AND created_at >= date_trunc('day', now())),
      'human_drops', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'human_drop' AND created_at >= date_trunc('day', now())),
      'fire_transfers', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'fire_transfer' AND created_at >= date_trunc('day', now())),
      'failed_transfers', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'human_drop' AND transfer_failure_reason <> '' AND created_at >= date_trunc('day', now())),
      'voice_messages', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'voice_message' AND created_at >= date_trunc('day', now())),
      'callbacks_due', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND callback_requested = true AND is_completed = false),
      'completed_callbacks', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND is_completed = true AND callback_requested = true),
      'voicemails_detected', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'voice_message' AND created_at >= date_trunc('day', now())),
      'no_answers', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'pending' AND disposition = 'no_answer' AND created_at >= date_trunc('day', now())),
      'busy_calls', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND disposition = 'busy' AND created_at >= date_trunc('day', now())),
      'invalid_numbers', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND disposition = 'invalid_number' AND created_at >= date_trunc('day', now())),
      'dnc_requests', (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND is_dnc = true AND created_at >= date_trunc('day', now())),
      'avg_ai_duration', (SELECT COALESCE(avg(duration_seconds), 0) FROM public.calls WHERE agent_id = v_agent.id AND is_live_human = true AND created_at >= date_trunc('day', now())),
      'talkroute_answer_rate', CASE
        WHEN (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND talkroute_leg_created = true AND created_at >= date_trunc('day', now())) > 0
        THEN (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND talkroute_answered = true AND created_at >= date_trunc('day', now()))::numeric /
        (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND talkroute_leg_created = true AND created_at >= date_trunc('day', now()))
        ELSE 0 END,
      'fire_transfer_rate', CASE
        WHEN (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND is_live_human = true AND created_at >= date_trunc('day', now())) > 0
        THEN (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND queue = 'fire_transfer' AND created_at >= date_trunc('day', now()))::numeric /
        (SELECT count(*) FROM public.calls WHERE agent_id = v_agent.id AND is_live_human = true AND created_at >= date_trunc('day', now()))
        ELSE 0 END,
      'last_call_time', (SELECT max(created_at) FROM public.calls WHERE agent_id = v_agent.id)
    ) INTO v_stats;
    v_stats := v_stats || v_durations;
    v_agents_list := array_append(v_agents_list, v_stats);
  END LOOP;
  v_agents := COALESCE(jsonb_agg(v), '[]'::jsonb) FROM unnest(v_agents_list) v;
  RETURN jsonb_build_object('summary', v_summary, 'agents', v_agents);
END;
$$;

-- ============================================================
-- 18. verify_session with owner role
-- ============================================================
CREATE OR REPLACE FUNCTION public.verify_session(p_session_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_session record;
  v_agent record;
BEGIN
  SELECT * INTO v_session FROM public.auth_sessions
  WHERE session_token = p_session_token AND invalidated_at IS NULL AND expires_at > now();
  IF v_session IS NULL THEN RETURN jsonb_build_object('valid', false); END IF;
  SELECT * INTO v_agent FROM public.agents WHERE id = v_session.agent_id;
  IF v_agent IS NULL OR v_agent.status NOT IN ('active') THEN
    UPDATE public.auth_sessions SET invalidated_at = now() WHERE id = v_session.id;
    RETURN jsonb_build_object('valid', false);
  END IF;
  RETURN jsonb_build_object(
    'valid', true,
    'agent', jsonb_build_object(
      'id', v_agent.id, 'full_name', v_agent.full_name, 'role', v_agent.role,
      'status', v_agent.status, 'available_for_transfer', v_agent.available_for_transfer,
      'logged_in', v_agent.logged_in, 'is_owner', v_agent.is_owner
    )
  );
END;
$$;

-- ============================================================
-- 19. agent_login (unchanged logic but handles owner too)
-- ============================================================
CREATE OR REPLACE FUNCTION public.agent_login(p_pin text, p_ip text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_agent record;
  v_session_token text;
  v_recent_fail_count integer;
BEGIN
  IF p_pin IS NULL OR p_pin !~ '^\d{4}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid PIN format');
  END IF;
  FOR v_agent IN SELECT * FROM public.agents WHERE status = 'active' LOOP
    BEGIN
      IF public.verify_pin(v_agent.id, p_pin) THEN
        SELECT COUNT(*) INTO v_recent_fail_count
        FROM public.login_attempts
        WHERE agent_id = v_agent.id AND success = false AND created_at > now() - interval '15 minutes';
        IF v_recent_fail_count >= 5 THEN
          INSERT INTO public.login_attempts (agent_id, ip_address, success) VALUES (v_agent.id, p_ip, false);
          INSERT INTO public.audit_logs (action, entity_type, entity_id, metadata)
          VALUES ('login_locked_out', 'agent', v_agent.id::text, jsonb_build_object('reason', 'rate_limit_exceeded'));
          RETURN jsonb_build_object('success', false, 'error', 'Account temporarily locked. Try again in 15 minutes.');
        END IF;
        IF v_agent.status = 'disabled' THEN
          INSERT INTO public.login_attempts (agent_id, ip_address, success) VALUES (v_agent.id, p_ip, false);
          INSERT INTO public.audit_logs (action, entity_type, entity_id, metadata)
          VALUES ('login_disabled', 'agent', v_agent.id::text, jsonb_build_object('reason', 'account_disabled'));
          RETURN jsonb_build_object('success', false, 'error', 'This account is inactive. Contact your administrator.');
        END IF;
        v_session_token := gen_random_uuid()::text || gen_random_uuid()::text;
        INSERT INTO public.auth_sessions (session_token, agent_id, expires_at, ip_address)
        VALUES (v_session_token, v_agent.id, now() + interval '8 hours', p_ip);
        INSERT INTO public.login_attempts (agent_id, ip_address, success) VALUES (v_agent.id, p_ip, true);
        UPDATE public.agents SET logged_in = true, last_seen_at = now() WHERE id = v_agent.id;
        INSERT INTO public.audit_logs (action, entity_type, entity_id, metadata)
        VALUES ('login_success', 'agent', v_agent.id::text, jsonb_build_object('ip', p_ip));
        RETURN jsonb_build_object(
          'success', true, 'session_token', v_session_token,
          'agent', jsonb_build_object(
            'id', v_agent.id, 'full_name', v_agent.full_name, 'role', v_agent.role,
            'status', v_agent.status, 'available_for_transfer', v_agent.available_for_transfer,
            'is_owner', v_agent.is_owner
          )
        );
      END IF;
    END;
  END LOOP;
  INSERT INTO public.login_attempts (agent_id, ip_address, success) VALUES (NULL, p_ip, false);
  INSERT INTO public.audit_logs (action, entity_type, entity_id, metadata)
  VALUES ('login_failed', 'auth', '', jsonb_build_object('ip', p_ip, 'reason', 'no_match'));
  RETURN jsonb_build_object('success', false, 'error', 'Invalid PIN. Please try again.');
END;
$$;

-- ============================================================
-- 20. Owner setup function
-- ============================================================
CREATE OR REPLACE FUNCTION public.owner_setup_pin(p_pin text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_owner record;
BEGIN
  IF p_pin IS NULL OR p_pin !~ '^\d{4}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'PIN must be exactly four digits');
  END IF;
  SELECT * INTO v_owner FROM public.agents WHERE is_owner = true LIMIT 1;
  IF v_owner IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Owner account not found'); END IF;
  IF v_owner.pin_digest <> '' THEN RETURN jsonb_build_object('success', false, 'error', 'Owner PIN already set'); END IF;
  PERFORM public.set_agent_pin(v_owner.id, p_pin);
  INSERT INTO public.audit_logs (action, entity_type, entity_id, metadata)
  VALUES ('owner_pin_set', 'agent', v_owner.id::text, jsonb_build_object('method', 'first_time_setup'));
  RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================
-- 21. owner_needs_setup
-- ============================================================
CREATE OR REPLACE FUNCTION public.owner_needs_setup()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_owner record;
BEGIN
  SELECT * INTO v_owner FROM public.agents WHERE is_owner = true LIMIT 1;
  IF v_owner IS NULL THEN RETURN jsonb_build_object('needs_setup', false, 'error', 'No owner account'); END IF;
  RETURN jsonb_build_object('needs_setup', v_owner.pin_digest = '');
END;
$$;

-- ============================================================
-- 22. Campaign control functions
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
  IF extract(hour FROM now() AT TIME ZONE 'America/New_York') < 9
     OR extract(hour FROM now() AT TIME ZONE 'America/New_York') >= 20
     OR extract(dow FROM now() AT TIME ZONE 'America/New_York') = 0 THEN
    v_blocking := v_blocking || 'Outside calling hours (9am-8pm ET, Mon-Sat). ';
  END IF;
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

CREATE OR REPLACE FUNCTION public.campaign_pause()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.campaigns ORDER BY created_at DESC LIMIT 1;
  UPDATE public.campaigns SET state = 'paused', updated_at = now() WHERE id = v_id;
  INSERT INTO public.campaign_events (campaign_id, event_type, event_data) VALUES (v_id, 'campaign_pause', '{}'::jsonb);
  RETURN jsonb_build_object('success', true, 'state', 'paused');
END;
$$;

CREATE OR REPLACE FUNCTION public.campaign_resume()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.campaigns ORDER BY created_at DESC LIMIT 1;
  UPDATE public.campaigns SET state = 'running', updated_at = now() WHERE id = v_id;
  INSERT INTO public.campaign_events (campaign_id, event_type, event_data) VALUES (v_id, 'campaign_resume', '{}'::jsonb);
  RETURN jsonb_build_object('success', true, 'state', 'running');
END;
$$;

CREATE OR REPLACE FUNCTION public.campaign_stop()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.campaigns ORDER BY created_at DESC LIMIT 1;
  UPDATE public.campaigns SET state = 'stopped', dialer_activated = false, updated_at = now() WHERE id = v_id;
  INSERT INTO public.campaign_events (campaign_id, event_type, event_data) VALUES (v_id, 'campaign_stop', '{}'::jsonb);
  RETURN jsonb_build_object('success', true, 'state', 'stopped');
END;
$$;

-- ============================================================
-- 23. Agent management functions
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_agent_dialer_selection(p_agent_id uuid, p_selected boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.agents SET active_for_dialer = p_selected WHERE id = p_agent_id AND is_owner = false;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Agent not found or is owner'); END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_agent_status(p_agent_id uuid, p_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.agents SET status = p_status WHERE id = p_agent_id AND is_owner = false;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Agent not found or is owner'); END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================
-- 24. Lead import function
-- ============================================================
CREATE OR REPLACE FUNCTION public.import_leads(p_leads jsonb, p_filename text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_lead jsonb; v_valid integer := 0; v_invalid integer := 0; v_import_id uuid;
BEGIN
  INSERT INTO public.lead_imports (filename, total_rows, valid_rows, invalid_rows, status)
  VALUES (p_filename, jsonb_array_length(p_leads), 0, 0, 'processing')
  RETURNING id INTO v_import_id;
  FOR v_lead IN SELECT * FROM jsonb_array_elements(p_leads) LOOP
    IF v_lead->>'name' IS NOT NULL AND v_lead->>'telephone_original' IS NOT NULL THEN
      INSERT INTO public.leads (name, telephone_original, telephone_normalized, address, income_range, home_value, property_information, notes, source, custom_fields, status)
      VALUES (v_lead->>'name', v_lead->>'telephone_original', public.normalize_phone(v_lead->>'telephone_original'),
        v_lead->>'address', v_lead->>'income_range', v_lead->>'home_value', v_lead->>'property_information',
        v_lead->>'notes', v_lead->>'source', COALESCE(v_lead->'custom_fields', '{}'::jsonb), 'new');
      v_valid := v_valid + 1;
    ELSE
      v_invalid := v_invalid + 1;
    END IF;
  END LOOP;
  UPDATE public.lead_imports SET valid_rows = v_valid, invalid_rows = v_invalid, status = 'completed' WHERE id = v_import_id;
  RETURN jsonb_build_object('success', true, 'imported', v_valid, 'invalid', v_invalid, 'import_id', v_import_id);
END;
$$;

-- ============================================================
-- 25. Lead pool stats
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_lead_pool_stats()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'total', (SELECT count(*) FROM public.leads),
    'new', (SELECT count(*) FROM public.leads WHERE status = 'new'),
    'pending', (SELECT count(*) FROM public.leads WHERE status = 'pending'),
    'called', (SELECT count(*) FROM public.leads WHERE status = 'called'),
    'assigned', (SELECT count(*) FROM public.leads WHERE assigned_agent_id IS NOT NULL),
    'unassigned', (SELECT count(*) FROM public.leads WHERE assigned_agent_id IS NULL)
  );
END;
$$;

-- ============================================================
-- 26. Get recent leads
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_recent_leads(p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (
    SELECT id, name, telephone_original, address, income_range, home_value, property_information, status, source, created_at, assigned_agent_id
    FROM public.leads ORDER BY created_at DESC LIMIT p_limit
  ) t;
END;
$$;

-- ============================================================
-- 27. Audit logs
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_audit_logs(p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (
    SELECT action, entity_type, entity_id, metadata, created_at FROM public.audit_logs ORDER BY created_at DESC LIMIT p_limit
  ) t;
END;
$$;

-- ============================================================
-- 28. Campaign events
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_campaign_events(p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (
    SELECT ce.event_type, ce.event_data, ce.created_at FROM public.campaign_events ce ORDER BY ce.created_at DESC LIMIT p_limit
  ) t;
END;
$$;
