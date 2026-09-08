/*
# Activate Mark Carlson for the dialer + create new 500-call campaign
*/

UPDATE public.agents
SET active_for_dialer = true
WHERE id = '03f30cd4-b21e-4a40-a611-df6cfd49d0ff';

INSERT INTO public.campaigns (state, provider_call_limit, started_at)
VALUES ('running', 500, now());
