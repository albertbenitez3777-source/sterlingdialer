/*
# Add inbound callback tracking and transfer state machine

## Purpose
The calls table was designed for outbound-only. Inbound callbacks need their
own call records, identified by the called Bland number. This migration adds
columns for a proper transfer state machine and webhook idempotency.

## Changes
1. `transfer_state` (text, default 'none') — fine-grained transfer lifecycle
2. `started_at` (timestamptz, nullable) — when the call started
3. `from_number` (text, default '') — caller's phone number
4. `to_number` (text, default '') — called Bland number
5. Unique partial index on `provider_call_id` for idempotent webhooks
6. Updated CHECK constraints for new transfer_status and transfer_state values
*/

ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS transfer_state text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS from_number text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS to_number text NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS calls_provider_call_id_unique_idx
  ON calls (provider_call_id)
  WHERE provider_call_id != '';

ALTER TABLE calls DROP CONSTRAINT IF EXISTS calls_transfer_status_check;
ALTER TABLE calls ADD CONSTRAINT calls_transfer_status_check
  CHECK (transfer_status = ANY (ARRAY['none', 'requested', 'successful', 'unsuccessful', 'transfer_api_accepted']));

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'calls_transfer_state_check'
      AND conrelid = 'calls'::regclass
  ) THEN
    ALTER TABLE calls ADD CONSTRAINT calls_transfer_state_check
      CHECK (transfer_state = ANY (ARRAY[
        'none',
        'transfer_requested',
        'transfer_api_accepted',
        'destination_ringing',
        'human_answered',
        'transfer_failed',
        'bridge_ended'
      ]));
  END IF;
END $$;