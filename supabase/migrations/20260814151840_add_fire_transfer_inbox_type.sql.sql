ALTER TABLE public.agent_inbox DROP CONSTRAINT IF EXISTS agent_inbox_type_check;
ALTER TABLE public.agent_inbox ADD CONSTRAINT agent_inbox_type_check
  CHECK (type = ANY (ARRAY['callback'::text, 'voicemail'::text, 'system'::text, 'transfer_failed'::text, 'fire_transfer'::text]));
