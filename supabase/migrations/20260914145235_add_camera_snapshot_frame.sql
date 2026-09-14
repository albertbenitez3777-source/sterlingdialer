/*
# Add snapshot frame column to camera status

1. Modified Tables
   - `federal_one_camera_status`
     - `last_frame` (text, nullable) — base64-encoded JPEG snapshot from the agent's webcam, 
       updated every few seconds while camera is active. Allows the supervisor to see 
       near-real-time thumbnails of each agent.

2. Notes
   - Kept nullable so existing rows are unaffected.
   - Frames are small low-quality JPEGs (~10-15KB base64).
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'federal_one_camera_status' AND column_name = 'last_frame'
  ) THEN
    ALTER TABLE federal_one_camera_status ADD COLUMN last_frame text;
  END IF;
END $$;
