/*
# v262: Transfer evidence columns + drop_reason classification + transfer proof RPC

## Summary
Adds audit-grade transfer evidence tracking columns to the calls table and a
normalized drop_reason classification. Creates an RPC for per-agent transfer
proof counts used by the admin Transfer Proof ledger.

## New columns on calls
- `destination_dialed_at` (timestamptz) — when the transfer destination was dialed
- `provider_transfer_id` (text) — provider's transfer leg/call ID if available
- `post_transfer_duration_seconds` (integer) — duration of the post-transfer leg only
- `rep_first_speech_at` (timestamptz) — first representative speech timestamp
- `drop_reason` (text) — normalized classification of call outcome/failure
- `post_transfer_transcript` (text) — post-transfer transcript stored separately

## New RPC
- `get_transfer_proof_stats(p_campaign_started_at timestamptz)` — returns per-agent
  transfer evidence counts for the admin ledger

## Notes
1. No existing columns are modified or dropped
2. Campaign RUNNING state is not affected
3. Dialer 3/3/3 concurrency + John exclusion preserved
4. 500-attempt hard cap preserved
*/

-- New evidence columns
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS destination_dialed_at timestamptz;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS provider_transfer_id text NOT NULL DEFAULT '';
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS post_transfer_duration_seconds integer NOT NULL DEFAULT 0;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS rep_first_speech_at timestamptz;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS drop_reason text NOT NULL DEFAULT '';
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS post_transfer_transcript text NOT NULL DEFAULT '';

-- Index for transfer proof queries
CREATE INDEX IF NOT EXISTS idx_calls_transfer_state ON public.calls (transfer_state) WHERE transfer_state <> 'none';

-- Transfer proof stats RPC for admin dashboard
CREATE OR REPLACE FUNCTION public.get_transfer_proof_stats(p_campaign_started_at timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_since timestamptz;
  v_result jsonb;
BEGIN
  v_since := COALESCE(p_campaign_started_at, (SELECT started_at FROM campaigns ORDER BY created_at DESC LIMIT 1));
  IF v_since IS NULL THEN v_since := now() - interval '7 days'; END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.agent_name), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      a.full_name AS agent_name,
      a.id AS agent_id,
      count(c.id) FILTER (WHERE c.call_direction = 'outbound') AS total_outbound,
      count(c.id) FILTER (WHERE c.transfer_requested_at IS NOT NULL) AS transfer_requested,
      count(c.id) FILTER (WHERE c.talkroute_leg_created = true) AS talkroute_dialed,
      count(c.id) FILTER (WHERE c.talkroute_answered = true) AS talkroute_answered,
      count(c.id) FILTER (WHERE c.rep_first_speech_at IS NOT NULL) AS rep_speech_detected,
      count(c.id) FILTER (WHERE c.bridge_confirmed = true) AS bridge_confirmed,
      count(c.id) FILTER (WHERE c.transfer_state = 'transfer_failed') AS transfer_failed,
      count(c.id) FILTER (WHERE c.queue = 'no_answer') AS no_answer,
      count(c.id) FILTER (WHERE c.queue = 'voice_message') AS voicemail,
      count(c.id) FILTER (WHERE c.queue = 'human_drop') AS human_drop,
      count(c.id) FILTER (WHERE c.is_dnc = true) AS dnc,
      count(c.id) FILTER (WHERE c.is_wrong_number = true) AS wrong_number,
      count(c.id) FILTER (WHERE c.is_live_human = true) AS live_humans,
      count(c.id) FILTER (WHERE c.drop_reason <> '' AND c.drop_reason <> 'none') AS classified_drops
    FROM agents a
    LEFT JOIN calls c ON c.agent_id = a.id AND c.created_at >= v_since AND c.call_direction = 'outbound'
    WHERE a.status IN ('active', 'archived') AND a.is_owner = false
    GROUP BY a.id, a.full_name
  ) t;

  RETURN jsonb_build_object(
    'since', v_since,
    'agents', v_result,
    'totals', (
      SELECT row_to_json(s) FROM (
        SELECT
          count(*) AS total_outbound,
          count(*) FILTER (WHERE transfer_requested_at IS NOT NULL) AS transfer_requested,
          count(*) FILTER (WHERE talkroute_leg_created = true) AS talkroute_dialed,
          count(*) FILTER (WHERE talkroute_answered = true) AS talkroute_answered,
          count(*) FILTER (WHERE rep_first_speech_at IS NOT NULL) AS rep_speech_detected,
          count(*) FILTER (WHERE bridge_confirmed = true) AS bridge_confirmed,
          count(*) FILTER (WHERE transfer_state = 'transfer_failed') AS transfer_failed,
          count(*) FILTER (WHERE drop_reason <> '' AND drop_reason <> 'none') AS classified_drops
        FROM calls
        WHERE created_at >= v_since AND call_direction = 'outbound'
      ) s
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_transfer_proof_stats(timestamptz) TO authenticated;
