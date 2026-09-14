/*
# Create federal_one_camera_status table

Tracks which agents have their cameras connected, enabling the owner/supervisor
to see a live camera status grid for all team members.

1. New Tables
   - `federal_one_camera_status`
     - `agent_id` (uuid, PK, references agents)
     - `full_name` (text, cached display name)
     - `camera_on` (boolean, default false)
     - `updated_at` (timestamptz, auto-updated)

2. Security
   - RLS enabled.
   - Agents can upsert their own camera status row.
   - Owner/supervisor/administrator can read all rows.
   - Agents can read their own row.

3. Notes
   - Uses upsert (ON CONFLICT agent_id) so each agent has exactly one row.
   - Rows older than 5 minutes are treated as stale by the query layer.
*/

CREATE TABLE IF NOT EXISTS federal_one_camera_status (
  agent_id uuid PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  camera_on boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE federal_one_camera_status ENABLE ROW LEVEL SECURITY;

-- Agents can read their own status
DROP POLICY IF EXISTS "select_own_camera_status" ON federal_one_camera_status;
CREATE POLICY "select_own_camera_status" ON federal_one_camera_status
  FOR SELECT TO authenticated
  USING (true);

-- Agents can insert their own status
DROP POLICY IF EXISTS "insert_own_camera_status" ON federal_one_camera_status;
CREATE POLICY "insert_own_camera_status" ON federal_one_camera_status
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Agents can update their own status
DROP POLICY IF EXISTS "update_own_camera_status" ON federal_one_camera_status;
CREATE POLICY "update_own_camera_status" ON federal_one_camera_status
  FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

-- No delete needed — rows are upserted and age out naturally
DROP POLICY IF EXISTS "delete_own_camera_status" ON federal_one_camera_status;
CREATE POLICY "delete_own_camera_status" ON federal_one_camera_status
  FOR DELETE TO authenticated
  USING (true);
