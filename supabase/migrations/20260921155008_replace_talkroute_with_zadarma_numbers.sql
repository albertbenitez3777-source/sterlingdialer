/*
# Replace Talkroute Numbers with Zadarma Numbers

1. Modified Tables
   - `agents`: Updated `talkroute_number` column values for all 3 active agents
     to their new Zadarma direct numbers. Added `zadarma_sip_login` and
     `zadarma_sip_password` text columns to store per-agent SIP credentials
     for browser-based WebRTC calling.

2. Agent Number Assignments
   - Erick Jackson: +1 (202) 982-4430
   - James Spencer: +1 (202) 773-9590
   - Mark Carlson:  +1 (202) 949-5811

3. Security
   - No RLS changes. Existing policies on `agents` still apply.

4. Notes
   - The `talkroute_number` column name is retained to avoid breaking the
     dialer loop, webhook, and all downstream functions that reference it.
     The column now stores Zadarma numbers instead.
   - SIP credential columns are nullable; they will be populated once
     PBX extensions are configured.
*/

-- Add SIP credential columns for browser WebRTC calling
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='agents' AND column_name='zadarma_sip_login') THEN
    ALTER TABLE agents ADD COLUMN zadarma_sip_login text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='agents' AND column_name='zadarma_sip_password') THEN
    ALTER TABLE agents ADD COLUMN zadarma_sip_password text;
  END IF;
END $$;

-- Swap Talkroute numbers to Zadarma numbers
UPDATE agents SET talkroute_number = '+12029824430' WHERE full_name = 'Erick Jackson' AND status = 'active';
UPDATE agents SET talkroute_number = '+12027739590' WHERE full_name = 'James Spencer' AND status = 'active';
UPDATE agents SET talkroute_number = '+12029495811' WHERE full_name = 'Mark Carlson'  AND status = 'active';

-- Store the shared SIP login for all agents (main Zadarma account)
UPDATE agents SET zadarma_sip_login = '528484' WHERE status = 'active' AND is_owner = false;
