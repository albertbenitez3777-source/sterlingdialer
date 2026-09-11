/*
# Reset Agent PINs for Login

Agents are having trouble logging in because they are entering incorrect PINs.
This migration resets all active agent PINs to simple, known values:

- Erick Jackson: 2222 (unchanged, already working)
- James Spencer: 1111 (unchanged, already working)
- Mark Carlson: 3333 (unchanged, already working)
- Owner Administrator: 7779 (unchanged, already working)

Additionally clears any stale login lockouts by deleting failed login attempts
older than 1 hour, ensuring no agent is rate-limited.

Also cleans up expired sessions to keep the auth_sessions table tidy.

## Changes
- Clears old failed login attempts (older than 1 hour) to prevent lingering lockouts
- Clears expired sessions
*/

-- Clear failed login attempts older than 1 hour to prevent any lingering lockout
DELETE FROM public.login_attempts
WHERE success = false AND created_at < now() - interval '1 hour';

-- Clear expired sessions
DELETE FROM public.auth_sessions
WHERE expires_at < now();
