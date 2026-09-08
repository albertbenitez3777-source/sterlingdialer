-- D1: No-Answer Retry — add retry_count and next_eligible_at to leads
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS next_eligible_at timestamptz;

-- D2: Daily Minutes Cap — add daily_minute_cap to campaigns
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS daily_minute_cap integer;

-- Index for the dialer to efficiently skip leads whose retry is pending
CREATE INDEX IF NOT EXISTS idx_leads_next_eligible_at ON public.leads (next_eligible_at) WHERE next_eligible_at IS NOT NULL;
