CREATE OR REPLACE FUNCTION public.match_chunks(query_embedding extensions.vector, match_count integer DEFAULT 5, p_psychologist_id uuid DEFAULT NULL::uuid, p_document_type text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, document_id uuid, content text, page_number integer, chunk_index integer, similarity double precision)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  select
    dc.id,
    dc.document_id,
    dc.content,
    dc.page_number,
    dc.chunk_index,
    1 - (dc.embedding::extensions.vector <=> query_embedding::extensions.vector) as similarity
  from public.document_chunks dc
  join public.documents d on d.id = dc.document_id
  where (d.is_global = true or d.psychologist_id = p_psychologist_id)
    and (p_document_type is null or d.document_type = p_document_type)
    and dc.embedding is not null
  order by dc.embedding::extensions.vector <=> query_embedding::extensions.vector
  limit match_count;
$function$;