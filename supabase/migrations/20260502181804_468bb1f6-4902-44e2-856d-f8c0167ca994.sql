CREATE OR REPLACE FUNCTION public.admin_document_chunk_counts()
RETURNS TABLE(document_id uuid, chunk_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.id AS document_id, COUNT(dc.id) AS chunk_count
  FROM public.documents d
  LEFT JOIN public.document_chunks dc ON dc.document_id = d.id
  WHERE d.is_global = true
    AND public.is_admin(auth.uid())
  GROUP BY d.id;
$$;