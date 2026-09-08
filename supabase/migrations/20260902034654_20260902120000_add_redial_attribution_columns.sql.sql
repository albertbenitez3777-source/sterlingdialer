-- Non-destructive migration: add redial attribution columns to calls table
-- These columns allow cross-agent redials to preserve original agent attribution
-- without overwriting existing data. All columns are nullable so existing rows
-- are unaffected. Backfill is limited to reliably derivable values only.

-- Add columns if they don't exist (idempotent via DO block)
DO $$
BEGIN
  -- original_agent_id: the agent who originally made the call (for redial rows, this is the source agent)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calls' AND column_name = 'original_agent_id') THEN
    ALTER TABLE public.calls ADD COLUMN original_agent_id uuid;
  END IF;

  -- redial_of: references the original call's id that this redial is re-dialing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calls' AND column_name = 'redial_of') THEN
    ALTER TABLE public.calls ADD COLUMN redial_of uuid;
  END IF;

  -- redial_source_type: 'live_transfers' or 'live_humans' or 'agent_selected'
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calls' AND column_name = 'redial_source_type') THEN
    ALTER TABLE public.calls ADD COLUMN redial_source_type text;
  END IF;

  -- redial_batch_id: UUID linking all calls in the same redial batch
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calls' AND column_name = 'redial_batch_id') THEN
    ALTER TABLE public.calls ADD COLUMN redial_batch_id uuid;
  END IF;
END $$;

-- Add foreign key constraints (skip if already exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'calls_original_agent_id_fkey'
  ) THEN
    ALTER TABLE public.calls
      ADD CONSTRAINT calls_original_agent_id_fkey
      FOREIGN KEY (original_agent_id) REFERENCES public.agents(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'calls_redial_of_fkey'
  ) THEN
    ALTER TABLE public.calls
      ADD CONSTRAINT calls_redial_of_fkey
      FOREIGN KEY (redial_of) REFERENCES public.calls(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Add indexes for efficient redial queries
CREATE INDEX IF NOT EXISTS idx_calls_original_agent_id ON public.calls (original_agent_id) WHERE original_agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_calls_redial_of ON public.calls (redial_of) WHERE redial_of IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_calls_redial_batch_id ON public.calls (redial_batch_id) WHERE redial_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_calls_redial_source_type ON public.calls (redial_source_type) WHERE redial_source_type IS NOT NULL;

-- Backfill original_agent_id for existing redial_batch calls where the agent_id
-- is the target (redialing) agent and the source can be derived from the agent_notes
-- pattern. Since the old code did not store original_agent_id, we can only set it
-- for calls where redial_count > 0 OR agent_notes LIKE 'redial_batch:%'.
-- We do NOT guess — only set original_agent_id = agent_id for non-redial calls
-- (where the agent IS the original agent) and leave redial calls as NULL since
-- the original source agent cannot be reliably determined post-hoc.
UPDATE public.calls
SET original_agent_id = agent_id
WHERE original_agent_id IS NULL
  AND agent_notes NOT LIKE 'redial_batch:%'
  AND agent_notes NOT LIKE 'agent_redial:%'
  AND redial_count = 0;
