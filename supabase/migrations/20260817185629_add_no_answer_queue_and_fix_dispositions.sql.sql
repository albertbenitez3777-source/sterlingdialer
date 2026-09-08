/*
# Add 'no_answer' queue value and fix existing pending+completed calls

## Problem
Calls that Bland couldn't disposition (no answer, busy, failed) were falling through
to queue = 'pending' in both the webhook and backfill, leaving them with no proper
disposition. The queue CHECK constraint doesn't include 'no_answer'.

## Changes
1. Add 'no_answer' to the queue CHECK constraint.
2. Update existing 131 calls that are stuck in pending+completed to 'no_answer'.
3. Reset their leads back to 'new' so they can be retried.

## Security
- No RLS or policy changes.
*/

-- Add 'no_answer' to the queue constraint
ALTER TABLE public.calls DROP CONSTRAINT IF EXISTS calls_queue_check;
ALTER TABLE public.calls ADD CONSTRAINT calls_queue_check 
  CHECK (queue = ANY (ARRAY['pending'::text, 'human_drop'::text, 'fire_transfer'::text, 'voice_message'::text, 'transfer_defect'::text, 'no_answer'::text]));

-- Fix existing calls stuck in pending+completed
UPDATE public.calls
SET queue = 'no_answer'
WHERE call_direction = 'outbound'
  AND queue = 'pending'
  AND is_completed = true
  AND provider_call_id IS NOT NULL AND provider_call_id <> '';

-- Reset leads for these calls back to 'new' so they can be retried
UPDATE public.leads
SET status = 'new'
WHERE status = 'in_progress'
  AND NOT EXISTS (
    SELECT 1 FROM public.calls c
    WHERE c.lead_id = leads.id
    AND c.call_direction = 'outbound'
    AND c.queue NOT IN ('no_answer', 'pending')
  );
