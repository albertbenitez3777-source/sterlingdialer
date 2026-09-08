/*
# Reset leads for new campaign dialing

All 1791 leads were called in the August 14 run and have provider_call_id
values on their prior calls. The dialer_next_batch function skips any lead
that already has an outbound call with a provider_call_id, which blocks
all re-dialing across campaigns.

This migration sets provider_call_id to empty string on calls from prior
campaigns so the dialer can re-dial the same leads in the new campaign.
The call history (transcripts, recordings, dispositions) is preserved.
*/

UPDATE public.calls
SET provider_call_id = ''
WHERE call_direction = 'outbound'
  AND created_at < '2026-08-17 16:49:00'
  AND provider_call_id IS NOT NULL
  AND provider_call_id <> '';