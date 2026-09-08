-- Add recording_url and transcript columns to agent_inbox
ALTER TABLE public.agent_inbox ADD COLUMN IF NOT EXISTS recording_url text DEFAULT '';
ALTER TABLE public.agent_inbox ADD COLUMN IF NOT EXISTS transcript text DEFAULT '';
