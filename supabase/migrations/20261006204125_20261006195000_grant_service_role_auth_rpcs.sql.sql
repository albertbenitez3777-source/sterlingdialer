/*
# Restore service-role execution for authentication RPCs

## Summary

This migration ensures the deployed authentication edge function can execute the login, session, logout, token-login, and owner setup database functions through Supabase's REST RPC gateway.

## Changes

### 1. Authentication functions
- Grants the `service_role` permission to execute the existing authentication functions.
- No tables, columns, rows, or data are created, changed, or removed.

## Security
- No anonymous or authenticated permissions are added.
- The grants apply only to the server-side `service_role`, which is used by the deployed edge function.

## Important notes
1. This is permission-only and preserves the existing authentication logic.
2. No user data is modified.
3. The browser still cannot call these privileged functions directly.
*/

GRANT EXECUTE ON FUNCTION public.agent_login(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_login_with_retired_pin_notice(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_login_by_token(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_logout(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_session(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.owner_setup_pin(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.owner_needs_setup() TO service_role;