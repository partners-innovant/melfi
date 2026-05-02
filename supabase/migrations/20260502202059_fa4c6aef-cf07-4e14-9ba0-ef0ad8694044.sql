ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS live_transcript jsonb NOT NULL DEFAULT '[]'::jsonb;