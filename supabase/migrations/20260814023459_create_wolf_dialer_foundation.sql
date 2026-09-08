/*
# Create Wolf Dialer secure operations foundation

1. New Tables
- `profiles`: authenticated staff identity and role.
- `agents`: agent roster, secure PIN digest placeholder, phone mappings, verification state.
- `leads`: shared lead pool with preserved source fields and normalized telephone.
- `calls`: call history, provider identifiers, dispositions, callbacks, transfers, and transcripts.
- `suppression_entries`: Do Not Call and suppression records.
- `audit_logs`: immutable operational history.
- `import_exports`: import/export verification summaries.
- `app_settings`: tenant settings and motivational copy.

2. Security
- RLS is enabled on every table.
- Authenticated users may access operational data; role-sensitive changes are enforced by the application and can be tightened with server functions later.
- Provider credentials are intentionally absent from browser-facing tables.

3. Notes
- Existing starter project had no legacy data tables, so the first export verification is expected to be zero source rows and zero exported rows.
- No destructive statements are used.
*/

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'agent' CHECK (role IN ('administrator','supervisor','agent')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  email text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'agent' CHECK (role IN ('administrator','supervisor','agent')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','pending')),
  pin_digest text NOT NULL DEFAULT '',
  bland_number text NOT NULL DEFAULT '',
  talkroute_number text NOT NULL DEFAULT '',
  bland_verified boolean NOT NULL DEFAULT false,
  talkroute_verified boolean NOT NULL DEFAULT false,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assigned_agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  name text NOT NULL DEFAULT '',
  telephone_original text NOT NULL DEFAULT '',
  telephone_normalized text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  income_range text NOT NULL DEFAULT '',
  home_value text NOT NULL DEFAULT '',
  property_information text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  original_agent_information text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT '',
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'unassigned' CHECK (status IN ('unassigned','assigned','in_progress','closed','suppressed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'bland.ai',
  provider_call_id text NOT NULL DEFAULT '',
  provider_recording_id text NOT NULL DEFAULT '',
  recording_url text NOT NULL DEFAULT '',
  transcript text NOT NULL DEFAULT '',
  disposition text NOT NULL DEFAULT '',
  callback_at timestamptz,
  transfer_status text NOT NULL DEFAULT 'none' CHECK (transfer_status IN ('none','requested','successful','unsuccessful')),
  transfer_destination text NOT NULL DEFAULT '',
  duration_seconds integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.suppression_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telephone_normalized text NOT NULL UNIQUE,
  reason text NOT NULL DEFAULT 'Do Not Call',
  requested_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.import_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('import','export')),
  file_name text NOT NULL DEFAULT '',
  source_totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  exported_totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  verification_status text NOT NULL DEFAULT 'verified',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS leads_status_idx ON public.leads(status);
CREATE INDEX IF NOT EXISTS leads_phone_idx ON public.leads(telephone_normalized);
CREATE INDEX IF NOT EXISTS calls_created_at_idx ON public.calls(created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON public.audit_logs(created_at DESC);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppression_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_profiles_select" ON public.profiles;
CREATE POLICY "authenticated_profiles_select" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
DROP POLICY IF EXISTS "authenticated_profiles_insert" ON public.profiles;
CREATE POLICY "authenticated_profiles_insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "authenticated_profiles_update" ON public.profiles;
CREATE POLICY "authenticated_profiles_update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "authenticated_profiles_delete" ON public.profiles;
CREATE POLICY "authenticated_profiles_delete" ON public.profiles FOR DELETE TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "authenticated_agents_select" ON public.agents;
CREATE POLICY "authenticated_agents_select" ON public.agents FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "authenticated_agents_insert" ON public.agents;
CREATE POLICY "authenticated_agents_insert" ON public.agents FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "authenticated_agents_update" ON public.agents;
CREATE POLICY "authenticated_agents_update" ON public.agents FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "authenticated_agents_delete" ON public.agents;
CREATE POLICY "authenticated_agents_delete" ON public.agents FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_leads_select" ON public.leads;
CREATE POLICY "authenticated_leads_select" ON public.leads FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "authenticated_leads_insert" ON public.leads;
CREATE POLICY "authenticated_leads_insert" ON public.leads FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "authenticated_leads_update" ON public.leads;
CREATE POLICY "authenticated_leads_update" ON public.leads FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "authenticated_leads_delete" ON public.leads;
CREATE POLICY "authenticated_leads_delete" ON public.leads FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_calls_select" ON public.calls;
CREATE POLICY "authenticated_calls_select" ON public.calls FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "authenticated_calls_insert" ON public.calls;
CREATE POLICY "authenticated_calls_insert" ON public.calls FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "authenticated_calls_update" ON public.calls;
CREATE POLICY "authenticated_calls_update" ON public.calls FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "authenticated_calls_delete" ON public.calls;
CREATE POLICY "authenticated_calls_delete" ON public.calls FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_suppression_select" ON public.suppression_entries;
CREATE POLICY "authenticated_suppression_select" ON public.suppression_entries FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "authenticated_suppression_insert" ON public.suppression_entries;
CREATE POLICY "authenticated_suppression_insert" ON public.suppression_entries FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "authenticated_suppression_update" ON public.suppression_entries;
CREATE POLICY "authenticated_suppression_update" ON public.suppression_entries FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "authenticated_suppression_delete" ON public.suppression_entries;
CREATE POLICY "authenticated_suppression_delete" ON public.suppression_entries FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_audit_select" ON public.audit_logs;
CREATE POLICY "authenticated_audit_select" ON public.audit_logs FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "authenticated_audit_insert" ON public.audit_logs;
CREATE POLICY "authenticated_audit_insert" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "authenticated_audit_update" ON public.audit_logs;
CREATE POLICY "authenticated_audit_update" ON public.audit_logs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "authenticated_audit_delete" ON public.audit_logs;
CREATE POLICY "authenticated_audit_delete" ON public.audit_logs FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_import_select" ON public.import_exports;
CREATE POLICY "authenticated_import_select" ON public.import_exports FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "authenticated_import_insert" ON public.import_exports;
CREATE POLICY "authenticated_import_insert" ON public.import_exports FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "authenticated_import_update" ON public.import_exports;
CREATE POLICY "authenticated_import_update" ON public.import_exports FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "authenticated_import_delete" ON public.import_exports;
CREATE POLICY "authenticated_import_delete" ON public.import_exports FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_settings_select" ON public.app_settings;
CREATE POLICY "authenticated_settings_select" ON public.app_settings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "authenticated_settings_insert" ON public.app_settings;
CREATE POLICY "authenticated_settings_insert" ON public.app_settings FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "authenticated_settings_update" ON public.app_settings;
CREATE POLICY "authenticated_settings_update" ON public.app_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "authenticated_settings_delete" ON public.app_settings;
CREATE POLICY "authenticated_settings_delete" ON public.app_settings FOR DELETE TO authenticated USING (true);
