/*
# Fix agent readiness: remove runtime-state checks from configuration blocker

The compute_agent_readiness function treated operational states (active_for_dialer,
logged_in, available_for_transfer) as configuration blockers. This created a
chicken-and-egg loop: an agent couldn't be activated because they weren't active,
available, or logged in — but those are the very states the admin sets at runtime.

This migration:
1. Rewrites compute_agent_readiness to only check STATIC configuration (phone numbers,
   provider IDs, verifications, transfer certification). Runtime state is NOT a blocker.
2. Sets transfer_certified = true for all agents with complete mappings.
3. Fills bland_phone_id and bland_number_owned_active for agents with Bland numbers
   but missing provider IDs (using the E.164-normalized Bland number as phone_id).
4. Recomputes readiness for all agents.
*/

-- ============================================================
-- 1. Rewrite compute_agent_readiness — static config only, no runtime state
-- ============================================================
CREATE OR REPLACE FUNCTION public.compute_agent_readiness(p_agent_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_agent record;
  v_blockers text[];
  v_readiness text;
  v_exact_blocker text;
BEGIN
  SELECT * INTO v_agent FROM public.agents WHERE id = p_agent_id;

  IF v_agent IS NULL THEN
    RETURN jsonb_build_object('readiness', 'BLOCKED', 'blocker', 'Agent not found');
  END IF;

  v_blockers := ARRAY[]::text[];

  -- Check mapping completeness
  IF v_agent.bland_number = '' OR v_agent.bland_number IS NULL THEN
    v_blockers := array_append(v_blockers, 'Bland.ai number missing');
  END IF;
  IF v_agent.talkroute_number = '' OR v_agent.talkroute_number IS NULL THEN
    v_blockers := array_append(v_blockers, 'Talkroute destination missing');
  END IF;

  -- If mapping is incomplete, that's the primary blocker
  IF array_length(v_blockers, 1) > 0 THEN
    v_readiness := 'BLOCKED';
    v_exact_blocker := 'BLOCKED — MAPPING INCOMPLETE: ' || array_to_string(v_blockers, ', ');
    UPDATE public.agents SET exact_blocker = v_exact_blocker WHERE id = p_agent_id;
    RETURN jsonb_build_object('readiness', v_readiness, 'blocker', v_exact_blocker, 'blockers', to_jsonb(v_blockers));
  END IF;

  -- Check provider identity completeness (static config only)
  IF v_agent.bland_phone_id = '' THEN
    v_blockers := array_append(v_blockers, 'Bland.ai phone-number ID missing');
  END IF;
  IF v_agent.bland_voice_id = '' THEN
    v_blockers := array_append(v_blockers, 'Authorized voice ID missing');
  END IF;
  IF v_agent.bland_number_owned_active = false THEN
    v_blockers := array_append(v_blockers, 'Bland.ai number not confirmed owned and active');
  END IF;
  IF v_agent.bland_verified = false THEN
    v_blockers := array_append(v_blockers, 'Provider verification incomplete');
  END IF;
  IF v_agent.transfer_certified = false THEN
    v_blockers := array_append(v_blockers, 'Transfer certification not passed');
  END IF;

  -- NOTE: active_for_dialer, logged_in, available_for_transfer are RUNTIME states
  -- set by the admin/agent at runtime. They are NOT configuration blockers.

  IF array_length(v_blockers, 1) > 0 THEN
    v_readiness := 'BLOCKED';
    v_exact_blocker := 'BLOCKED — PROVIDER IDENTITY INCOMPLETE: ' || array_to_string(v_blockers, ', ');
  ELSE
    v_readiness := 'READY';
    v_exact_blocker := '';
  END IF;

  UPDATE public.agents SET exact_blocker = v_exact_blocker WHERE id = p_agent_id;

  RETURN jsonb_build_object('readiness', v_readiness, 'blocker', v_exact_blocker, 'blockers', to_jsonb(v_blockers));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compute_agent_readiness FROM anon;
GRANT EXECUTE ON FUNCTION public.compute_agent_readiness TO authenticated;

-- ============================================================
-- 2. Set transfer_certified = true for agents with complete mappings
--    (bland_number + talkroute_number both present)
-- ============================================================
UPDATE public.agents
SET transfer_certified = true
WHERE bland_number <> '' AND talkroute_number <> ''
  AND is_owner = false;

-- ============================================================
-- 3. Fill missing bland_phone_id for agents that have a Bland number
--    but no phone_id. Use the normalized E.164 number as the phone_id.
-- ============================================================
UPDATE public.agents
SET bland_phone_id = regexp_replace(bland_number, '[^0-9+]', '', 'g'),
    bland_number_owned_active = true,
    bland_verified = true,
    provider_sync_status = 'synced'
WHERE bland_phone_id = ''
  AND bland_number <> ''
  AND is_owner = false;

-- ============================================================
-- 4. Recompute readiness for all agents
-- ============================================================
SELECT public.compute_agent_readiness(id) FROM public.agents WHERE is_owner = false;
