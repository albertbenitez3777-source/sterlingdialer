-- Agent inbox for callback notifications when calls drop
CREATE TABLE IF NOT EXISTS public.agent_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  call_id uuid REFERENCES public.calls(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  type text NOT NULL DEFAULT 'callback' CHECK (type = ANY (ARRAY['callback', 'voicemail', 'system', 'transfer_failed'])),
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  consumer_name text DEFAULT '',
  consumer_phone text DEFAULT '',
  is_read boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_inbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_inbox" ON public.agent_inbox FOR SELECT
  TO authenticated USING (auth.uid()::text = (SELECT pin_digest FROM public.agents WHERE id = agent_id) OR EXISTS (SELECT 1 FROM public.agents a WHERE a.id = agent_inbox.agent_id AND a.role IN ('owner','administrator')));

CREATE POLICY "insert_inbox" ON public.agent_inbox FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "update_own_inbox" ON public.agent_inbox FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "delete_own_inbox" ON public.agent_inbox FOR DELETE
  TO authenticated USING (true);

CREATE INDEX idx_agent_inbox_agent ON public.agent_inbox(agent_id);
CREATE INDEX idx_agent_inbox_unread ON public.agent_inbox(agent_id) WHERE is_read = false;
CREATE INDEX idx_agent_inbox_created ON public.agent_inbox(created_at DESC);
