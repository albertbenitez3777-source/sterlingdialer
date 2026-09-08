INSERT INTO storage.buckets (id, name, public)
VALUES ('call-recordings', 'call-recordings', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access to recordings
CREATE POLICY "public_read_call_recordings"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'call-recordings');

-- Allow authenticated service role to upload
CREATE POLICY "service_upload_call_recordings"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK (bucket_id = 'call-recordings');

CREATE POLICY "service_update_call_recordings"
ON storage.objects FOR UPDATE
TO anon, authenticated
USING (bucket_id = 'call-recordings')
WITH CHECK (bucket_id = 'call-recordings');