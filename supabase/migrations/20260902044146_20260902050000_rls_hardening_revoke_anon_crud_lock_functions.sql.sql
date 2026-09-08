/*
# Database Security Hardening — Revoke Anonymous CRUD, Lock Down Functions

## Summary

This migration comprehensively locks down the database to prevent any direct
anonymous or authenticated REST API access to tables or SECURITY DEFINER
functions. The application architecture uses custom server-validated
`auth_sessions` (not Supabase Auth), and ALL data access flows through edge
functions using the service role key — the browser never calls `.from()` or
`.rpc()` directly. Therefore anon/authenticated direct CRUD is unnecessary
and is revoked entirely.

## Changes

### 1. Table Privileges (19 public tables)
- REVOKE ALL (SELECT, INSERT, UPDATE, DELETE) from `anon` and `authenticated`
  on every public table.
- Drop ALL existing permissive `USING (true)` / `WITH CHECK (true)` policies.
- RLS remains ENABLED on all tables — with no policies and no grants, the
  tables are deny-by-default for any non-service-role caller.
- The `service_role` and `postgres` superuser retain full access and bypass
  RLS, so all edge functions continue to work unchanged.

### 2. SECURITY DEFINER Function Privileges (50 functions)
- REVOKE EXECUTE from `PUBLIC`, `anon`, and `authenticated` on every
  SECURITY DEFINER function in the public schema.
- These functions are only called from edge functions using the service role
  key (via REST API or direct Postgres connection), which bypasses EXECUTE
  checks.
- This prevents an attacker with the anon key from invoking privileged
  functions like `agent_login`, `verify_session`, `dialer_next_batch`,
  `get_admin_stats`, etc. directly via the REST API.

### 3. Search Path Hardening (2 functions)
- Fix `get_agent_login_hours`: add `SET search_path = public`
- Fix `normalize_phone`: add `SET search_path = public` (non-SECURITY DEFINER
  but still callable by anon — will be revoked below)

### 4. Storage Bucket Hardening
- Drop the `public_read_call_recordings` SELECT policy on `storage.objects`
  so anonymous users cannot read call recordings.
- Keep service-role INSERT/UPDATE policies for edge function uploads.
- Recording URLs stored in the `calls` table are external Bland AI URLs,
  not Supabase storage paths, so this does not break audio playback.

## Security Impact

Before: 19 tables with anon CRUD grants + `USING(true)` policies, 50
SECURITY DEFINER functions executable by anon, public-readable storage bucket.

After: 0 tables accessible by anon/authenticated, 0 SECURITY DEFINER
functions executable by anon/authenticated, 0 public-readable storage
policies. All access requires the service role key.

## Important Notes
1. No data is deleted, modified, or renamed.
2. No columns are changed.
3. The service_role key retains full access to all objects.
4. The postgres superuser retains full access to all objects.
5. Edge functions use service_role key — no behavior change.
6. The browser never directly accesses the database — no behavior change.
7. If a future feature requires browser-direct table access, it must add
   explicit grants and scoped policies at that time.
*/

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. REVOKE ALL TABLE PRIVILEGES from anon and authenticated
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  tbl record;
BEGIN
  FOR tbl IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', tbl.relname);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', tbl.relname);
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. DROP ALL existing permissive policies on public tables
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT p.polname, c.relname
    FROM pg_policy p
    JOIN pg_class c ON p.polrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.polname, pol.relname);
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. REVOKE EXECUTE on ALL SECURITY DEFINER functions from PUBLIC/anon/auth
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.proname, p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I FROM PUBLIC', fn.proname);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I FROM anon', fn.proname);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I FROM authenticated', fn.proname);
  END LOOP;
END $$;

-- Also revoke on normalize_phone (not SECURITY DEFINER but was anon-callable)
REVOKE EXECUTE ON FUNCTION public.normalize_phone FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.normalize_phone FROM anon;
REVOKE EXECUTE ON FUNCTION public.normalize_phone FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Fix mutable search_path on get_agent_login_hours
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop and recreate with safe search_path
DROP FUNCTION IF EXISTS public.get_agent_login_hours(text);
CREATE OR REPLACE FUNCTION public.get_agent_login_hours(p_agent_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'date', to_char(login_date, 'YYYY-MM-DD'),
      'hours', ROUND((total_seconds::numeric / 3600), 2)
    )
  ), '[]'::jsonb) INTO result
  FROM (
    SELECT
      DATE(created_at) as login_date,
      SUM(EXTRACT(EPOCH FROM (
        LEAST(expiry_ts, NOW()) - created_at
      )))::bigint as total_seconds
    FROM auth_sessions
    WHERE agent_id = p_agent_id::uuid
      AND expiry_ts > created_at
    GROUP BY DATE(created_at)
    ORDER BY login_date DESC
    LIMIT 7
  ) daily;
  RETURN result;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Fix mutable search_path on normalize_phone
-- ═══════════════════════════════════════════════════════════════════════════

-- We need to know the function signature to recreate it
-- normalize_phone takes text, returns text
DO $$
BEGIN
  -- Check if function exists and recreate with search_path
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'normalize_phone'
  ) THEN
    -- Get the function body to recreate it
    -- We use ALTER FUNCTION to set search_path (safer than drop/recreate)
    EXECUTE 'ALTER FUNCTION public.normalize_phone(text) SET search_path = public';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Lock down storage: drop public read on call-recordings bucket
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "public_read_call_recordings" ON storage.objects;

-- Also revoke anon SELECT on storage.objects to prevent any bucket access
REVOKE SELECT ON storage.objects FROM anon;
REVOKE INSERT ON storage.objects FROM anon;
REVOKE UPDATE ON storage.objects FROM anon;
REVOKE DELETE ON storage.objects FROM anon;

-- Revoke on other storage tables too
REVOKE ALL ON storage.buckets FROM anon;
REVOKE ALL ON storage.buckets_analytics FROM anon;
REVOKE ALL ON storage.buckets_vectors FROM anon;
REVOKE ALL ON storage.s3_multipart_uploads FROM anon;
REVOKE ALL ON storage.s3_multipart_uploads_parts FROM anon;
REVOKE ALL ON storage.vector_indexes FROM anon;
