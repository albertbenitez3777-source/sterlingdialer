/*
# Add talkroute_destination column to calls table

## New Columns
- `calls.talkroute_destination`: text, nullable. Stores the Talkroute number
  that Elizabeth Sterling transferred the call to. Used for audit trail and
  agent dashboard display.
*/
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'calls' AND column_name = 'talkroute_destination'
  ) THEN
    ALTER TABLE public.calls ADD COLUMN talkroute_destination text;
  END IF;
END $$;
