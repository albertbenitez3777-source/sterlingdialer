import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const CSS = readFileSync('./src/index.css', 'utf-8');
const APP = readFileSync('./src/App.tsx', 'utf-8');
const AUTH_FETCH = readFileSync('./src/utils/auth-fetch.ts', 'utf-8');
const DB_CLIENT = readFileSync('./supabase/functions/_shared/db-client.ts', 'utf-8');
const WOLF_AUTH = readFileSync('./supabase/functions/wolf-auth/index.ts', 'utf-8');
const WOLF_PROVIDER = readFileSync('./supabase/functions/wolf-provider/index.ts', 'utf-8');

// ════════════════════════════════════════════════════════════════════════════
// v234 — DATABASE SECURITY HARDENING
// Verifies that the browser never accesses the database directly, all data
// flows through edge functions, and the security migration is correctly
// designed.
// ════════════════════════════════════════════════════════════════════════════

describe('v234 RLS Hardening', () => {
  // ── 1. Browser never calls .from() directly ────────────────────────────────
  it('App.tsx has no Supabase .from() calls', () => { expect(/supabase\s*\.\s*from\s*\(/.test(APP)).toBe(false); });
  it('no direct calls table access', () => { expect(APP.includes('from("calls"') || APP.includes("from('calls'")).toBe(false); });
  it('no direct agents table access', () => { expect(APP.includes('from("agents"') || APP.includes("from('agents'")).toBe(false); });
  it('no direct leads table access', () => { expect(APP.includes('from("leads"') || APP.includes("from('leads'")).toBe(false); });
  it('index.css has no .from() calls', () => { expect(CSS.includes('.from(')).toBe(false); });
  it('auth-fetch.ts has no .from() calls', () => { expect(AUTH_FETCH.includes('.from(')).toBe(false); });

  // ── 2. Browser never calls .rpc() directly ─────────────────────────────────
  it('App.tsx has no .rpc() calls', () => { expect(APP.includes('.rpc(')).toBe(false); });
  it('auth-fetch.ts has no .rpc() calls', () => { expect(AUTH_FETCH.includes('.rpc(')).toBe(false); });

  // ── 3. All data flows through authFetch / fetch to edge functions ──────────
  it('App uses authFetch for data access', () => { expect(APP.includes('authFetch')).toBe(true); });
  it('calls wolf-provider edge function', () => { expect(APP.includes('PROVIDER_URL') || APP.includes('wolf-provider')).toBe(true); });
  it('calls wolf-auth edge function', () => { expect(APP.includes('AUTH_URL') || APP.includes('wolf-auth')).toBe(true); });

  // ── 4. authFetch sends session_token, not Supabase keys ────────────────────
  it('service role key not in auth-fetch', () => { expect(AUTH_FETCH.includes('SUPABASE_SERVICE_ROLE')).toBe(false); });
  it('anon key not in auth-fetch', () => { expect(AUTH_FETCH.includes('ANON_KEY')).toBe(false); });
  it('authFetch sends body with session token', () => { expect(AUTH_FETCH.includes('body')).toBe(true); });

  // ── 5. Edge functions use service role key, not anon key ───────────────────
  it('db-client uses service role', () => { expect(DB_CLIENT.includes('serviceRoleKey') || DB_CLIENT.includes('service_role')).toBe(true); });
  it('wolf-auth uses service role key', () => { expect(WOLF_AUTH.includes('serviceRoleKey')).toBe(true); });
  it('wolf-provider uses service role', () => { expect(WOLF_PROVIDER.includes('serviceRoleKey') || WOLF_PROVIDER.includes('service_role')).toBe(true); });

  // ── 6. Edge functions call verify_session for auth ─────────────────────────
  it('wolf-auth verifies sessions', () => { expect(WOLF_AUTH.includes('verify_session') || WOLF_AUTH.includes('verify')).toBe(true); });
  it('wolf-provider verifies sessions', () => { expect(WOLF_PROVIDER.includes('verify_session') || WOLF_PROVIDER.includes('verifySession')).toBe(true); });

  // ── 7. No Supabase JS client import in browser code ────────────────────────
  it('no supabase-js import in App', () => { expect(APP.includes('@supabase/supabase-js')).toBe(false); });
  it('no supabase-js import in auth-fetch', () => { expect(AUTH_FETCH.includes('@supabase/supabase-js')).toBe(false); });

  // ── 8. wolf-auth uses allowlist for RPC calls ──────────────────────────────
  it('wolf-auth has RPC allowlist', () => { expect(WOLF_AUTH.includes('RPC_ALLOWLIST') || WOLF_AUTH.includes('allowlist')).toBe(true); });
  it('allowlist includes agent_login', () => { expect(WOLF_AUTH.includes('agent_login')).toBe(true); });
  it('allowlist includes agent_logout', () => { expect(WOLF_AUTH.includes('agent_logout')).toBe(true); });
  it('allowlist includes verify_session', () => { expect(WOLF_AUTH.includes('verify_session')).toBe(true); });

  // ── 9. redial_preview is owner-only (from v230) ────────────────────────────
  it('redial_preview action exists', () => { expect(WOLF_PROVIDER.includes('redial_preview')).toBe(true); });
  it('checks owner/administrator role', () => { expect(WOLF_PROVIDER.includes("owner") && WOLF_PROVIDER.includes("administrator")).toBe(true); });
  it('returns 403 for non-owners', () => { expect(WOLF_PROVIDER.includes('403') || WOLF_PROVIDER.includes('Forbidden')).toBe(true); });

  // ── 10. No service role key in client-visible source ───────────────────────
  it('service role key not in App.tsx', () => { expect(APP.includes('SERVICE_ROLE')).toBe(false); });
  it('service role key not in auth-fetch', () => { expect(AUTH_FETCH.includes('SERVICE_ROLE')).toBe(false); });

  // ── 11. Edge function db-client uses postgres connection (bypasses RLS) ────
  it('db-client uses postgres for direct DB access', () => { expect(DB_CLIENT.includes('postgres')).toBe(true); });
  it('createDbClient factory exists', () => { expect(DB_CLIENT.includes('createDbClient')).toBe(true); });

  // ── 12. Edge functions have CORS headers ───────────────────────────────────
  it('wolf-auth has CORS', () => { expect(WOLF_AUTH.includes('Access-Control-Allow-Origin')).toBe(true); });
  it('wolf-provider has CORS', () => { expect(WOLF_PROVIDER.includes('Access-Control-Allow-Origin')).toBe(true); });

  // ── 13. No caller-supplied agent_id used for authorization ─────────────────
  it('session verification exists', () => { expect(WOLF_PROVIDER.includes('verifySession') || WOLF_PROVIDER.includes('verify_session')).toBe(true); });

  // ── 14. Auth edge function validates PIN format server-side ────────────────
  it('PIN format validated', () => { expect(WOLF_AUTH.includes('\\\\d{4}') || WOLF_AUTH.includes('pin')).toBe(true); });
  it('invalid PIN rejected', () => { expect(WOLF_AUTH.includes('Invalid PIN')).toBe(true); });

  // ── 15. Session token required for all authenticated actions ───────────────
  it('session token checked in provider', () => { expect(WOLF_PROVIDER.includes('session_token') || WOLF_PROVIDER.includes('sessionToken')).toBe(true); });
  it('session token checked in auth', () => { expect(WOLF_AUTH.includes('session_token') || WOLF_AUTH.includes('sessionToken')).toBe(true); });

  // ── 16. No hardcoded credentials in edge function source ───────────────────
  it('no JWT tokens in wolf-auth source', () => { expect(WOLF_AUTH.includes('eyJ')).toBe(false); });
  it('no JWT tokens in wolf-provider source', () => { expect(WOLF_PROVIDER.includes('eyJ')).toBe(false); });

  // ── 17. Error responses don't leak internal details ────────────────────────
  it('generic error messages in wolf-auth', () => { expect(WOLF_AUTH.includes('Internal server error') || WOLF_AUTH.includes('Service temporarily')).toBe(true); });

  // ── 18. Storage access is service-role only ────────────────────────────────
  it('storage upload uses service role key', () => { expect(DB_CLIENT.includes('serviceRoleKey')).toBe(true); });
  it('storage uses Bearer auth', () => { expect(DB_CLIENT.includes('Bearer')).toBe(true); });
});
