/*
# Switch James Spencer's Bland.ai dialer number to +1 (301) 264-7620

## Summary
James Spencer's outbound Bland.ai number is changed from +1 (771) 202-6103
to +1 (301) 264-7620 (previously assigned to archived agent John McCarthy).
The 301 number's ownership is marked active for James. Inbound configuration
is enabled so the number accepts incoming calls. James and Todd Sloane are
both activated for the dialer with their existing concurrency settings.

## Changes
1. agents table — James Spencer row:
   - bland_number → '+1 (301) 264-7620'
   - bland_phone_id → '+13012647620'
   - bland_number_owned_active → true
   - inbound_configured → true
   - provider_sync_status → 'synced'
   - active_for_dialer → true
2. agents table — John McCarthy row (archived):
   - bland_number cleared to '' (number reassigned to James)
   - bland_phone_id cleared to ''
   - bland_number_owned_active → false
3. agents table — Todd Sloane row:
   - active_for_dialer → true (already true, idempotent)
4. No schema changes. No RLS changes.
*/

UPDATE agents
SET bland_number = '+1 (301) 264-7620',
    bland_phone_id = '+13012647620',
    bland_number_owned_active = true,
    inbound_configured = true,
    provider_sync_status = 'synced',
    active_for_dialer = true
WHERE id = 'c242abef-c01e-490b-bab6-859cd89bd08a';

UPDATE agents
SET bland_number = '',
    bland_phone_id = '',
    bland_number_owned_active = false
WHERE id = '1b01a583-98c5-439a-999e-d312c68106c3';

UPDATE agents
SET active_for_dialer = true
WHERE id = 'bf021c46-10ca-45a4-b800-08f5e181834e';
