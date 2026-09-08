/*
# Pre-flight cleanup: reset stuck leads, stop old campaign, activate all 4 agents

1. Changes
- Reset 3 leads stuck in 'in_progress' back to 'new' so the dialer retries them.
- Stop the current running campaign (state = 'stopped') so a fresh campaign
  can be started with a clean call count.
- Activate all 4 active agents for the dialer (active_for_dialer = true).
- No new tables, no new columns, no RLS changes.
*/

-- Reset stuck leads
UPDATE public.leads SET status = 'new' WHERE status = 'in_progress';

-- Stop the old campaign
UPDATE public.campaigns SET state = 'stopped' WHERE state = 'running';

-- Activate all 4 active agents for the dialer
UPDATE public.agents SET active_for_dialer = true
WHERE status = 'active' AND is_owner = false AND transfer_certified = true;
