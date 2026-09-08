/*
# Add agent_direct_number and transfer_route_used columns

1. New Columns
- `agents.agent_direct_number` (text, nullable) — The number where the agent's phone
  ACTUALLY rings (cell or direct desk line), in E.164. When set, Bland transfers
  directly to this number instead of routing through the Talkroute hub.
- `calls.transfer_route_used` (text, nullable) — Tracks which transfer path was used:
  'direct' (agent_direct_number) or 'hub' (talkroute_number fallback).
  Allows the dashboard to visually separate direct-answer transfers from hub-routed ones.

2. Security
- No new tables. No RLS policy changes. Existing policies on agents and calls
  remain unchanged — the new columns inherit the same row-level access rules.

3. Notes
- agent_direct_number is nullable so existing agents continue using talkroute_number
  as fallback until an admin sets the direct number.
- transfer_route_used is nullable so existing call records are unaffected.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agents' AND column_name = 'agent_direct_number'
  ) THEN
    ALTER TABLE agents ADD COLUMN agent_direct_number text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'calls' AND column_name = 'transfer_route_used'
  ) THEN
    ALTER TABLE calls ADD COLUMN transfer_route_used text;
  END IF;
END $$;
