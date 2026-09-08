/*
# Update agent roster: new Talkroute numbers, remove Matt Vargas

1. Changes
- Archive Matt Vargas (status = 'archived', active_for_dialer = false, transfer_certified = false).
  His 603 historical call records are preserved for reporting.
- Update Talkroute numbers for 3 agents:
  - Mark Carlson:   +1 (800) 967-3308  →  +1 (855) 888-8360
  - John McCarthy:  +1 (202) 886-0121  →  +1 (877) 704-0210
  - Erick Jackson:  +1 (800) 490-7196  →  +1 (866) 350-2227
  (James Spencer already has +1 (800) 403-1524 — no change needed.)
- Set inbound_configured = false for all 4 active agents so the
  configure-inbound edge function will re-push the new Talkroute
  numbers to Bland.ai on the next configuration run.
- No new tables, no new columns, no RLS changes.

2. Rationale
- Each agent got a new Talkroute number. The dialer reads talkroute_number
  from the agents table at call-creation time, so updating the column
  is sufficient for outbound transfers.
- Inbound (callback) routing is configured on Bland.ai's side via
  /v1/inbound/{bland_number} with transfer_phone_number = talkroute_number.
  Setting inbound_configured = false forces a re-configure so callbacks
  forward to the new Talkroute numbers.
- Matt Vargas is being removed from the active roster — archiving
  (not deleting) preserves his call history for admin reporting.
*/

UPDATE public.agents SET
  status = 'archived',
  active_for_dialer = false,
  transfer_certified = false,
  inbound_configured = false
WHERE full_name = 'Matt Vargas';

UPDATE public.agents SET
  talkroute_number = '+1 (855) 888-8360',
  inbound_configured = false
WHERE full_name = 'Mark Carlson';

UPDATE public.agents SET
  talkroute_number = '+1 (877) 704-0210',
  inbound_configured = false
WHERE full_name = 'John McCarthy';

UPDATE public.agents SET
  talkroute_number = '+1 (866) 350-2227',
  inbound_configured = false
WHERE full_name = 'Erick Jackson';

UPDATE public.agents SET
  inbound_configured = false
WHERE full_name = 'James Spencer';
