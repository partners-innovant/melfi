-- Add classification columns to documents
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS clinical_areas text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS source_institution text,
  ADD COLUMN IF NOT EXISTS source_institution_type text;

-- Add denormalized classification columns to document_chunks (copied from parent doc at insert time)
ALTER TABLE public.document_chunks
  ADD COLUMN IF NOT EXISTS clinical_areas text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS source_institution text,
  ADD COLUMN IF NOT EXISTS source_institution_type text,
  ADD COLUMN IF NOT EXISTS document_type text,
  ADD COLUMN IF NOT EXISTS is_global boolean NOT NULL DEFAULT false;

-- Optional indexes to speed up filtering
CREATE INDEX IF NOT EXISTS document_chunks_clinical_areas_idx ON public.document_chunks USING GIN (clinical_areas);
CREATE INDEX IF NOT EXISTS documents_clinical_areas_idx ON public.documents USING GIN (clinical_areas);
CREATE INDEX IF NOT EXISTS document_chunks_source_institution_idx ON public.document_chunks (source_institution);
CREATE INDEX IF NOT EXISTS documents_source_institution_idx ON public.documents (source_institution);

-- Replace match_chunks with the new signature supporting clinical_area + source_institution filters
DROP FUNCTION IF EXISTS public.match_chunks(extensions.vector, integer, uuid, text);
DROP FUNCTION IF EXISTS public.match_chunks(extensions.vector, integer, uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.match_chunks(
  query_embedding extensions.vector,
  match_count integer DEFAULT 5,
  p_psychologist_id uuid DEFAULT NULL,
  p_document_type text DEFAULT NULL,
  p_clinical_area text DEFAULT NULL,
  p_source_institution text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  content text,
  page_number integer,
  chunk_index integer,
  is_global boolean,
  document_type text,
  clinical_areas text[],
  source_institution text,
  similarity double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    dc.id,
    dc.document_id,
    dc.content,
    dc.page_number,
    dc.chunk_index,
    COALESCE(dc.is_global, d.is_global) AS is_global,
    COALESCE(dc.document_type, d.document_type) AS document_type,
    COALESCE(NULLIF(dc.clinical_areas, '{}'), d.clinical_areas) AS clinical_areas,
    COALESCE(dc.source_institution, d.source_institution) AS source_institution,
    1 - (dc.embedding::extensions.vector <=> query_embedding::extensions.vector) AS similarity
  FROM public.document_chunks dc
  JOIN public.documents d ON d.id = dc.document_id
  WHERE (d.is_global = true OR d.psychologist_id = p_psychologist_id)
    AND (p_document_type IS NULL OR COALESCE(dc.document_type, d.document_type) = p_document_type)
    AND (p_clinical_area IS NULL OR p_clinical_area = ANY(COALESCE(NULLIF(dc.clinical_areas, '{}'), d.clinical_areas)))
    AND (p_source_institution IS NULL OR COALESCE(dc.source_institution, d.source_institution) = p_source_institution)
    AND dc.embedding IS NOT NULL
  ORDER BY dc.embedding::extensions.vector <=> query_embedding::extensions.vector
  LIMIT match_count;
$$;