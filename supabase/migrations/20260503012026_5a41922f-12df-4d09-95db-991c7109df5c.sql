ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS journal text;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS repository text;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS repository_id text;