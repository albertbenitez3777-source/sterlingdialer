/*
# Add connected_at timestamp to camera status

1. Modified Tables
   - `federal_one_camera_status`
     - `connected_at` (timestamptz, nullable) — records when the agent first turned on their camera
       in the current session. Cleared when they disconnect. Used by the admin to show
       how long each agent has been connected.

2. Notes
   - Nullable so existing rows and disconnected agents have NULL.
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'federal_one_camera_status' AND column_name = 'connected_at'
  ) THEN
    ALTER TABLE federal_one_camera_status ADD COLUMN connected_at timestamptz;
  END IF;
END $$;
