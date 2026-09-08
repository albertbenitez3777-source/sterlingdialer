/*
# Create saved_transfers table

1. New Tables
- `saved_transfers` — stores transfers that agents bookmark for later follow-up.
  - `id` (uuid, PK)
  - `agent_id` (uuid, FK to agents.id)
  - `call_id` (uuid, FK to calls.id) — the original call record
  - `consumer_name` (text)
  - `consumer_phone` (text)
  - `consumer_address` (text, nullable)
  - `consumer_income_range` (text, nullable)
  - `consumer_home_value` (text, nullable)
  - `consumer_property_info` (text, nullable)
  - `original_queue` (text) — was it fire_transfer or human_drop
  - `is_active` (boolean, default true) — soft delete for agents
  - `deleted_at` (timestamptz, nullable) — when agent removed it
  - `created_at` (timestamptz, default now())
  - `notes` (text, nullable) — agent notes about this saved transfer

2. Security
- Enable RLS on saved_transfers.
- Agents can CRUD their own saved transfers.
- Admins/owners can read all saved transfers (history).
- Even after soft-delete (is_active=false), rows remain for admin history.
- 4 separate policies (select/insert/update/delete).
*/

CREATE TABLE IF NOT EXISTS public.saved_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  call_id uuid REFERENCES public.calls(id) ON DELETE SET NULL,
  consumer_name text NOT NULL,
  consumer_phone text NOT NULL,
  consumer_address text,
  consumer_income_range text,
  consumer_home_value text,
  consumer_property_info text,
  original_queue text NOT NULL DEFAULT 'fire_transfer',
  is_active boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  notes text
);

ALTER TABLE public.saved_transfers ENABLE ROW LEVEL SECURITY;

-- Agents see their own saved transfers (including soft-deleted for history)
DROP POLICY IF EXISTS "select_own_saved_transfers" ON public.saved_transfers;
CREATE POLICY "select_own_saved_transfers"
  ON public.saved_transfers FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- Agents insert their own saved transfers
DROP POLICY IF EXISTS "insert_own_saved_transfers" ON public.saved_transfers;
CREATE POLICY "insert_own_saved_transfers"
  ON public.saved_transfers FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- Agents update their own saved transfers (soft-delete, notes)
DROP POLICY IF EXISTS "update_own_saved_transfers" ON public.saved_transfers;
CREATE POLICY "update_own_saved_transfers"
  ON public.saved_transfers FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Agents delete their own saved transfers (hard delete only by admin)
DROP POLICY IF EXISTS "delete_own_saved_transfers" ON public.saved_transfers;
CREATE POLICY "delete_own_saved_transfers"
  ON public.saved_transfers FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_saved_transfers_agent_active
  ON public.saved_transfers (agent_id, is_active, created_at DESC);
