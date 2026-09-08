-- Function to handle no-answer retry: called when a call ends as no_answer
-- Sets retry_count=1, next_eligible_at=now()+3hours, status='new' if eligible
-- Never retries DNC, closed, declined, or confirmed-voicemail leads
CREATE OR REPLACE FUNCTION public.handle_no_answer_retry(p_lead_id uuid, p_call_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_lead record;
  v_call record;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT * INTO v_call FROM public.calls WHERE id = p_call_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Never retry DNC, closed, or leads that already used their retry
  IF v_lead.status IN ('closed', 'dnc') OR v_lead.retry_count >= 1 THEN
    RETURN;
  END IF;

  -- Never retry if the call was DNC or wrong number
  IF v_call.is_dnc = true OR v_call.is_wrong_number = true THEN
    RETURN;
  END IF;

  -- Never retry if the call had voicemail disposition
  IF v_call.queue = 'voice_message' THEN
    RETURN;
  END IF;

  -- Only retry if the call actually ended as no_answer
  IF v_call.queue <> 'no_answer' THEN
    RETURN;
  END IF;

  -- Eligible for retry: set retry_count=1, next_eligible_at=now()+3hrs, status='new'
  UPDATE public.leads
  SET retry_count = 1,
      next_eligible_at = now() + interval '3 hours',
      status = 'new'
  WHERE id = p_lead_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.handle_no_answer_retry(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_no_answer_retry(uuid, uuid) TO authenticated, anon;

-- Function to check daily minutes cap — returns true if cap reached
CREATE OR REPLACE FUNCTION public.check_daily_minute_cap()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_cap integer;
  v_today_minutes numeric;
BEGIN
  SELECT daily_minute_cap INTO v_cap FROM public.campaigns ORDER BY created_at DESC LIMIT 1;
  IF v_cap IS NULL OR v_cap <= 0 THEN
    RETURN false;
  END IF;

  SELECT COALESCE(sum(duration_seconds), 0)::numeric / 60.0 INTO v_today_minutes
  FROM public.calls
  WHERE call_direction = 'outbound'
    AND bridge_confirmed = true
    AND created_at >= date_trunc('day', now());

  RETURN v_today_minutes >= v_cap;
END;
$function$;

REVOKE ALL ON FUNCTION public.check_daily_minute_cap() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_daily_minute_cap() TO authenticated, anon;
