/*
# Fix: drop unique outbound phone index that blocks cross-campaign retries

## Problem
The unique index `idx_calls_unique_outbound_phone` enforced that each phone
number can only have ONE outbound call record EVER. This blocked the dialer
from retrying leads in a new campaign even though the dedup logic in
dialer_next_batch was correctly scoped to the current campaign's started_at.

## Fix
Drop the unique index. The dedup logic in dialer_next_batch already prevents
double-dialing within a campaign by checking for existing calls with a real
provider_call_id created after the campaign's started_at. The unique index
was redundant and harmful for cross-campaign retries.

Also clean up old call records so the dialer can start fresh for the new campaign.
*/

DROP INDEX IF EXISTS public.idx_calls_unique_outbound_phone;

-- Replace with a non-unique index for query performance
CREATE INDEX IF NOT EXISTS idx_calls_outbound_phone_created 
ON public.calls (consumer_phone, call_direction, created_at DESC)
WHERE call_direction = 'outbound';

-- Clean up the debug function
DROP FUNCTION IF EXISTS public.dialer_next_batch_debug();