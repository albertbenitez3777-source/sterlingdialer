/*
# Reset All PINs and Activate Dialer for 100 Calls

## Changes
1. Resets all three active agent PINs to known values:
   - Owner Administrator: 7779
   - James Spencer: 1234
   - Todd Sloane: 4321
2. Clears all failed login attempts (removes any rate-limit lockouts)
3. Clears all expired auth sessions
4. Activates both James Spencer and Todd Sloane for the dialer with concurrency 1 each
5. Sets campaign to appointment mode with 100 call limit, concurrency 2, dialer activated
6. Clears any blocking reason

## Security
- No RLS policy changes
- No schema changes
- PINs are hashed with salt via the existing set_agent_pin function
*/

-- Reset all three PINs to known values
SELECT public.set_agent_pin('Owner Administrator', '7779');
SELECT public.set_agent_pin('James Spencer', '1234');
SELECT public.set_agent_pin('Todd Sloane', '4321');

-- Clear ALL failed login attempts to remove any lockouts
DELETE FROM public.login_attempts WHERE success = false;

-- Clear ALL expired sessions
DELETE FROM public.auth_sessions WHERE expires_at < now();

-- Activate both agents for the dialer
UPDATE public.agents
SET active_for_dialer = true,
    dialer_concurrency = 1,
    status = 'active',
    logged_in = false
WHERE full_name IN ('James Spencer', 'Todd Sloane');

-- Ensure owner is active but not part of dialer rotation
UPDATE public.agents
SET active_for_dialer = false
WHERE full_name = 'Owner Administrator';

-- Set campaign to appointment mode with 100 call limit and activate dialer
UPDATE public.campaigns
SET state = 'appointment',
    dialer_activated = true,
    concurrency = 2,
    provider_call_limit = 100,
    blocking_reason = ''
WHERE id = (SELECT id FROM public.campaigns ORDER BY created_at DESC LIMIT 1);
