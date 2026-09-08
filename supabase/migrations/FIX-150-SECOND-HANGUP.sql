/*
# Raise the 150-second auto-clean so it stops killing live transfers
#
# Same bug as the edge function: the SQL side of dialer_next_batch marks any
# 'pending' call older than 150 seconds as no_answer. Its "transfer aware"
# exclusions (transfer_requested_at IS NULL / talkroute_leg_created = false)
# only protect a call if a real-time transfer webhook already landed, and
# Bland's native transfer_phone_number path does not reliably send one while
# the call is still up. So a normal 2-minute conversation that then transfers
# gets cleaned at 2:30 while Talkroute is ringing the agent.
#
# We tell Bland max_duration: 8 (minutes). The watchdog must sit under that,
# not at a quarter of it. 420 seconds = 7 minutes.
#
# This edits ONLY the auto-clean interval inside dialer_next_batch. Apply it
# after copying the current function body from the latest dialer migration
# (v259) so nothing else changes.
*/

-- In dialer_next_batch, change the auto-clean block from:
--
--   WHERE queue = 'pending' AND is_completed = false
--     AND created_at < now() - interval '150 seconds'
--
-- to:
--
--   WHERE queue = 'pending' AND is_completed = false
--     AND created_at < now() - interval '420 seconds'
--
-- Keep every existing exclusion (queue != 'fire_transfer',
-- transfer_requested_at IS NULL, talkroute_leg_created = false,
-- ai_terminated = false) exactly as they are.

-- Sanity check after deploying: no completed call should carry an
-- "Auto-killed" note while also showing a transfer was dialed.
SELECT count(*) AS killed_mid_transfer
FROM public.calls
WHERE agent_notes ILIKE '%Auto-killed%'
  AND talkroute_leg_created = true
  AND talkroute_answered = false
  AND created_at >= now() - interval '2 days';
