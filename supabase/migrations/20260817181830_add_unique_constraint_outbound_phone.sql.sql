-- Add the unique constraint: each phone number can only have ONE outbound call ever.
-- This is the ultimate guard — the database itself will reject any duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS idx_calls_unique_outbound_phone
  ON public.calls (consumer_phone)
  WHERE call_direction = 'outbound';
