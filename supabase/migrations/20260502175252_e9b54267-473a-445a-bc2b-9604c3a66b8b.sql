
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS patient_interventions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS therapist_notes_live jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS claude_suggestions_used jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS session_summary text,
  ADD COLUMN IF NOT EXISTS clinical_feedback text,
  ADD COLUMN IF NOT EXISTS therapist_audio_path text,
  ADD COLUMN IF NOT EXISTS therapist_text_complement text,
  ADD COLUMN IF NOT EXISTS session_mode_status text,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- Storage bucket for therapist session audio (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('session-audio', 'session-audio', false)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for the new bucket: each therapist can manage files under their own uid folder
DROP POLICY IF EXISTS "Therapists read own session audio" ON storage.objects;
CREATE POLICY "Therapists read own session audio"
ON storage.objects FOR SELECT
USING (bucket_id = 'session-audio' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Therapists upload own session audio" ON storage.objects;
CREATE POLICY "Therapists upload own session audio"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'session-audio' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Therapists update own session audio" ON storage.objects;
CREATE POLICY "Therapists update own session audio"
ON storage.objects FOR UPDATE
USING (bucket_id = 'session-audio' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Therapists delete own session audio" ON storage.objects;
CREATE POLICY "Therapists delete own session audio"
ON storage.objects FOR DELETE
USING (bucket_id = 'session-audio' AND auth.uid()::text = (storage.foldername(name))[1]);
