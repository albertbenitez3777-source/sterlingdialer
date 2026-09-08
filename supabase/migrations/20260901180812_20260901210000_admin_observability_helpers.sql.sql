/*
# Admin Observability — Helper Functions

1. get_funnel_stats(p_start, p_end): single-scan funnel + minutes + machine-waste stats
2. get_recent_errors(p_limit): recent transfer failures, auto-kills, Bland API errors
*/

CREATE OR REPLACE FUNCTION public.get_funnel_stats(p_start timestamptz, p_end timestamptz)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(jsonb_build_object(
    'calls_attempted', count(*) FILTER (WHERE call_direction = 'outbound' AND provider_call_id <> ''),
    'live_humans_reached', count(*) FILTER (WHERE is_live_human = true),
    'transfers_requested', count(*) FILTER (WHERE queue = 'fire_transfer' OR transfer_requested_at IS NOT NULL),
    'talkroute_answered', count(*) FILTER (WHERE talkroute_answered = true),
    'bridge_confirmed', count(*) FILTER (WHERE bridge_confirmed = true),
    'likely_real_conversation', count(*) FILTER (WHERE bridge_confirmed = true AND duration_seconds >= 45),
    'total_minutes', round(COALESCE(sum(duration_seconds), 0)::numeric / 60.0, 1),
    'productive_minutes', round(COALESCE(sum(duration_seconds) FILTER (WHERE bridge_confirmed = true), 0)::numeric / 60.0, 1),
    'wasted_minutes', round(COALESCE(sum(duration_seconds) FILTER (WHERE queue IN ('no_answer','voice_message') OR is_live_human = false), 0)::numeric / 60.0, 1),
    'machine_minutes', round(COALESCE(sum(duration_seconds) FILTER (WHERE queue = 'voice_message'), 0)::numeric / 60.0, 1),
    'avg_ai_leg_seconds', round(COALESCE(avg(duration_seconds) FILTER (WHERE bridge_confirmed = false AND duration_seconds > 0), 0)::numeric, 1),
    'machines_detected', count(*) FILTER (WHERE queue = 'voice_message'),
    'avg_machine_seconds', round(COALESCE(avg(duration_seconds) FILTER (WHERE queue = 'voice_message' AND duration_seconds > 0), 0)::numeric, 1),
    'no_answer_count', count(*) FILTER (WHERE queue = 'no_answer'),
    'human_drop_count', count(*) FILTER (WHERE queue = 'human_drop'),
    'voice_message_count', count(*) FILTER (WHERE queue = 'voice_message'),
    'fire_transfer_count', count(*) FILTER (WHERE queue = 'fire_transfer'),
    'pending_count', count(*) FILTER (WHERE queue = 'pending')
  ), '{}'::jsonb)
  FROM public.calls
  WHERE created_at >= p_start AND created_at < p_end
$$;

REVOKE EXECUTE ON FUNCTION public.get_funnel_stats(timestamptz, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_funnel_stats(timestamptz, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_recent_errors(p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_errors jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_errors
  FROM (
    SELECT
      c.created_at,
      c.consumer_phone,
      c.consumer_name,
      ag.full_name AS agent_name,
      CASE
        WHEN c.transfer_failure_reason <> '' THEN 'transfer_failure'
        WHEN c.agent_notes ILIKE '%Auto-killed%' THEN 'auto_killed'
        WHEN c.agent_notes ILIKE '%Bland API error%' THEN 'bland_api_error'
        ELSE 'other_error'
      END AS error_type,
      CASE
        WHEN c.transfer_failure_reason <> '' THEN c.transfer_failure_reason
        WHEN c.agent_notes ILIKE '%Auto-killed%' THEN substring(c.agent_notes from position('Auto-killed' in c.agent_notes) for 120)
        WHEN c.agent_notes ILIKE '%Bland API error%' THEN substring(c.agent_notes from position('Bland API error' in c.agent_notes) for 120)
        ELSE c.agent_notes
      END AS reason,
      c.queue,
      c.duration_seconds,
      c.talkroute_answered,
      c.bridge_confirmed
    FROM public.calls c
    LEFT JOIN public.agents ag ON ag.id = c.agent_id
    WHERE c.transfer_failure_reason <> ''
       OR c.agent_notes ILIKE '%Auto-killed%'
       OR c.agent_notes ILIKE '%Bland API error%'
    ORDER BY c.created_at DESC
    LIMIT p_limit
  ) t;
  RETURN v_errors;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_recent_errors(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_recent_errors(integer) TO authenticated;
