ALTER TABLE public.consultations ADD COLUMN IF NOT EXISTS conversation_id uuid;
ALTER TABLE public.consultations ADD COLUMN IF NOT EXISTS conversation_title text;
CREATE INDEX IF NOT EXISTS idx_consultations_conv ON public.consultations(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_consultations_psych ON public.consultations(psychologist_id, created_at DESC);