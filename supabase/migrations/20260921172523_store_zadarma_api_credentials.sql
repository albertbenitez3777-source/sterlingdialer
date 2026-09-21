/*
# Store Zadarma API credentials

1. New Tables
  - `system_config` - Key-value store for system-level configuration
    - `key` (text, primary key)
    - `value` (text, not null)
    - `created_at` (timestamptz)

2. Security
  - RLS enabled, NO public policies (only service_role can read)
  - Revoke all access from anon and authenticated roles

3. Data
  - Inserts Zadarma API key and secret for use by edge functions

4. Important Notes
  - This table is NOT accessible from the browser/client
  - Only edge functions using service_role key can read these values
*/

CREATE TABLE IF NOT EXISTS system_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;

-- No policies = no access for anon or authenticated
-- Only service_role bypasses RLS

REVOKE ALL ON system_config FROM anon, authenticated;

INSERT INTO system_config (key, value) VALUES
  ('zadarma_api_key', 'ec71e3a9a8aef6196bbc'),
  ('zadarma_api_secret', '339ae9448e97628aadde')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
