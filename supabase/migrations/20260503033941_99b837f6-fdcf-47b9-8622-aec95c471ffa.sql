ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS next_session_suggestions text;
ALTER TABLE public.child_patients ADD COLUMN IF NOT EXISTS next_session_suggestions text;