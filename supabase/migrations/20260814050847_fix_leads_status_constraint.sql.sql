/*
# Fix leads status constraint to allow 'new' and 'pending' statuses

The leads table CHECK constraint only allowed: unassigned, assigned, in_progress,
closed, suppressed. But both the import_leads function (which inserts with status
'new') and the campaign_start function (which counts leads with status IN
('new', 'pending')) require the 'new' and 'pending' statuses. This mismatch
caused every imported lead to keep status 'unassigned' (the column default) and
the campaign to always report "No eligible leads."

This migration:
1. Adds 'new' and 'pending' to the leads status check constraint.
2. Updates all 'unassigned' leads to 'new' so they become eligible for dialing.
3. Resets the campaign to 'stopped' state with no blocking reason for a clean start.
*/

-- ============================================================
-- 1. Update leads status check constraint to include 'new' and 'pending'
-- ============================================================
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_status_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_status_check
  CHECK (status = ANY (ARRAY[
    'new'::text, 'pending'::text, 'unassigned'::text,
    'assigned'::text, 'in_progress'::text, 'closed'::text, 'suppressed'::text
  ]));

-- ============================================================
-- 2. Update all unassigned leads to 'new' status
-- ============================================================
UPDATE public.leads SET status = 'new' WHERE status = 'unassigned';

-- ============================================================
-- 3. Reset campaign to stopped state for clean start
-- ============================================================
UPDATE public.campaigns
SET state = 'stopped',
    dialer_activated = false,
    blocking_reason = '',
    updated_at = now()
WHERE id = (SELECT id FROM public.campaigns ORDER BY created_at DESC LIMIT 1);
