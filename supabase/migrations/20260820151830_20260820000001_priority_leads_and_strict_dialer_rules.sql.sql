/*
# Priority Leads + Strict Dialer Rules

## What this does
1. Adds `is_priority` boolean column to the `leads` table (defaults false).
   Priority leads are called FIRST, even if they've been called before.
2. Adds `priority_batch_id` text column to track which priority import a lead came from.
3. Rewrites `dialer_next_batch()` to:
   - Select priority leads first (ORDER BY is_priority DESC, created_at ASC)
   - Bypass the "one dollar only" dedup rule for priority leads ONLY
   - Regular leads still follow the global dedup rule (each number dialed once, ever)
4. Adds an index on `is_priority` + `status` for fast priority lookups.

## Why
The user wants to re-call a specific list of past live-human contacts as the
first calls of the morning, even if those numbers were already dialed. After
the priority list is exhausted, the dialer continues with new leads that have
never been called.

## Security
- No RLS changes (leads table already has policies).
- No destructive operations.
*/

-- Add priority columns to leads
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS is_priority boolean NOT NULL DEFAULT false;
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS priority_batch_id text NOT NULL DEFAULT '';

-- Index for fast priority lead selection
CREATE INDEX IF NOT EXISTS idx_leads_priority_status
  ON public.leads (is_priority, status)
  WHERE is_priority = true;

-- ── Updated dialer_next_batch ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dialer_next_batch()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_campaign record;
  v_remaining integer;
  v_calls_placed integer;
  v_results jsonb[] := ARRAY[]::jsonb[];
  v_lead record;
  v_call_id uuid;
  v_agent record;
  v_agent_remaining integer;
  v_phone_already_called boolean;
BEGIN
  SELECT * INTO v_campaign FROM public.campaigns ORDER BY created_at DESC LIMIT 1;
  IF v_campaign.state <> 'running' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Campaign is not running');
  END IF;

  -- Auto-clean stale pending calls older than 10 minutes
  UPDATE public.calls
  SET is_completed = true,
      queue = CASE WHEN queue = 'pending' THEN 'no_answer' ELSE queue END,
      agent_notes = COALESCE(agent_notes, '') || ' [Auto-cleaned: stale pending]'
  WHERE queue = 'pending' AND is_completed = false AND created_at < now() - interval '10 minutes';

  -- Delete failed call records (never reached Bland) so leads can be retried
  DELETE FROM public.calls
  WHERE call_direction = 'outbound'
    AND (provider_call_id IS NULL OR provider_call_id = '');

  -- Reset leads that had failed calls back to 'new' so they get retried
  -- (only if they have NO real call record from ANY campaign)
  UPDATE public.leads
  SET status = 'new'
  WHERE status = 'in_progress'
    AND NOT EXISTS (
      SELECT 1 FROM public.calls c
      WHERE c.lead_id = leads.id
        AND c.call_direction = 'outbound'
        AND c.provider_call_id IS NOT NULL AND c.provider_call_id <> ''
    );

  -- Mark NON-PRIORITY leads as 'closed' if their phone has ANY completed call
  -- Priority leads are EXEMPT from this — they can be re-dialed
  UPDATE public.leads
  SET status = 'closed'
  WHERE status = 'in_progress'
    AND is_priority = false
    AND telephone_normalized <> ''
    AND EXISTS (
      SELECT 1 FROM public.calls c
      WHERE c.consumer_phone = leads.telephone_normalized
        AND c.call_direction = 'outbound'
        AND c.provider_call_id IS NOT NULL AND c.provider_call_id <> ''
    );

  -- Also close any 'new' non-priority leads that were already called
  UPDATE public.leads
  SET status = 'closed'
  WHERE status = 'new'
    AND is_priority = false
    AND telephone_normalized <> ''
    AND EXISTS (
      SELECT 1 FROM public.calls c
      WHERE c.consumer_phone = leads.telephone_normalized
        AND c.call_direction = 'outbound'
        AND c.provider_call_id IS NOT NULL AND c.provider_call_id <> ''
    );

  -- Count successfully placed calls since this campaign started
  SELECT count(*) INTO v_calls_placed FROM public.calls
  WHERE created_at >= v_campaign.started_at
    AND call_direction = 'outbound'
    AND provider_call_id IS NOT NULL AND provider_call_id <> '';

  v_remaining := v_campaign.provider_call_limit - v_calls_placed;
  IF v_remaining <= 0 THEN
    RETURN jsonb_build_object('success', true, 'calls_to_dial', 0, 'message', 'Call limit reached');
  END IF;

  -- Loop over ALL agents with active_for_dialer = true
  FOR v_agent IN
    SELECT * FROM public.agents
    WHERE active_for_dialer = true
      AND status = 'active'
      AND is_owner = false
      AND bland_number <> ''
      AND talkroute_number <> ''
      AND transfer_certified = true
  LOOP
    v_agent_remaining := LEAST(v_agent.dialer_concurrency, v_remaining);
    IF v_agent_remaining <= 0 THEN EXIT; END IF;

    -- PRIORITY leads first: status = 'new' OR 'in_progress', is_priority = true
    -- These bypass the dedup check — they get called even if previously dialed
    FOR v_lead IN
      SELECT l.id, l.name, l.telephone_original, l.telephone_normalized,
             l.address, l.income_range, l.home_value, l.property_information,
             l.notes, l.source, l.custom_fields, l.is_priority
      FROM public.leads l
      WHERE l.is_priority = true
        AND l.status IN ('new', 'in_progress', 'closed')
        AND l.telephone_normalized <> ''
      ORDER BY l.created_at ASC
      FOR UPDATE OF l SKIP LOCKED
      LIMIT v_agent_remaining
    LOOP
      UPDATE public.leads SET status = 'in_progress' WHERE id = v_lead.id;

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
          'call_id', v_call_id,
          'lead_id', v_lead.id,
          'phone', v_lead.telephone_normalized,
          'name', v_lead.name,
          'agent_id', v_agent.id,
          'agent_name', v_agent.full_name,
          'bland_number', v_agent.bland_number,
          'bland_phone_id', v_agent.bland_phone_id,
          'bland_voice_id', v_agent.bland_voice_id,
          'talkroute_number', v_agent.talkroute_number,
          'is_priority', true
        ));

        v_remaining := v_remaining - 1;
      EXCEPTION WHEN unique_violation THEN
        UPDATE public.leads SET status = 'closed' WHERE id = v_lead.id;
      END;
    END LOOP;

    -- If we still have room, pull NON-PRIORITY new leads (with dedup)
    IF v_remaining > 0 THEN
      v_agent_remaining := LEAST(v_agent.dialer_concurrency, v_remaining);
      IF v_agent_remaining <= 0 THEN EXIT; END IF;

      FOR v_lead IN
        SELECT l.id, l.name, l.telephone_original, l.telephone_normalized,
               l.address, l.income_range, l.home_value, l.property_information,
               l.notes, l.source, l.custom_fields, l.is_priority
        FROM public.leads l
        WHERE l.status = 'new'
          AND l.is_priority = false
          AND l.telephone_normalized <> ''
          AND NOT EXISTS (
            SELECT 1 FROM public.calls c
            WHERE c.consumer_phone = l.telephone_normalized
              AND c.call_direction = 'outbound'
              AND c.provider_call_id IS NOT NULL AND c.provider_call_id <> ''
          )
        ORDER BY l.created_at ASC
        FOR UPDATE OF l SKIP LOCKED
        LIMIT v_agent_remaining
      LOOP
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

        UPDATE public.leads SET status = 'in_progress' WHERE id = v_lead.id;

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
            'call_id', v_call_id,
            'lead_id', v_lead.id,
            'phone', v_lead.telephone_normalized,
            'name', v_lead.name,
            'agent_id', v_agent.id,
            'agent_name', v_agent.full_name,
            'bland_number', v_agent.bland_number,
            'bland_phone_id', v_agent.bland_phone_id,
            'bland_voice_id', v_agent.bland_voice_id,
            'talkroute_number', v_agent.talkroute_number,
            'is_priority', false
          ));

          v_remaining := v_remaining - 1;
        EXCEPTION WHEN unique_violation THEN
          UPDATE public.leads SET status = 'closed' WHERE id = v_lead.id;
        END;
      END LOOP;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'calls_to_dial', jsonb_array_length(to_jsonb(v_results)),
    'calls', to_jsonb(v_results)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.dialer_next_batch() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dialer_next_batch() TO authenticated, anon;
