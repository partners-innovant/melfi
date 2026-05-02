-- Add language column to documents for the admin documents manager
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS language text;

-- Mirror to chunks so AI filtering can later use it without a join
ALTER TABLE public.document_chunks
  ADD COLUMN IF NOT EXISTS language text;