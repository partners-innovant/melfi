ALTER TABLE public.documents
ADD COLUMN IF NOT EXISTS processing_mode text
  CHECK (processing_mode IN ('text', 'vision'))
  DEFAULT 'text';