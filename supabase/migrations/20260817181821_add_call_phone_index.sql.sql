-- Add an index to speed up the NOT EXISTS check in dialer_next_batch
CREATE INDEX IF NOT EXISTS idx_calls_consumer_phone_direction
  ON public.calls (consumer_phone, call_direction);
