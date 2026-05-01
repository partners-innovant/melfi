ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS extended_notes text;
ALTER TABLE public.child_patients ADD COLUMN IF NOT EXISTS extended_notes text;