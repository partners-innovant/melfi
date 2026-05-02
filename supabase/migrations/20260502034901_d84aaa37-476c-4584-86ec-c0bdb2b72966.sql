drop function if exists public.match_chunks(extensions.vector, integer, uuid, text, text, text);

create or replace function public.match_chunks(
  query_embedding extensions.vector,
  match_count integer default 5,
  p_psychologist_id uuid default null,
  p_document_type text default null,
  p_clinical_area text default null,
  p_source_institution text default null,
  p_year_from integer default null,
  p_clinical_areas text[] default null,
  p_source_institutions text[] default null
)
returns table (
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
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    dc.id,
    dc.document_id,
    dc.content,
    dc.page_number,
    dc.chunk_index,
    coalesce(dc.is_global, d.is_global) as is_global,
    coalesce(dc.document_type, d.document_type) as document_type,
    coalesce(nullif(dc.clinical_areas, '{}'), d.clinical_areas) as clinical_areas,
    coalesce(dc.source_institution, d.source_institution) as source_institution,
    1 - (dc.embedding::extensions.vector <=> query_embedding::extensions.vector) as similarity
  from public.document_chunks dc
  join public.documents d on d.id = dc.document_id
  where (d.is_global = true or d.psychologist_id = p_psychologist_id)
    and (p_document_type is null or coalesce(dc.document_type, d.document_type) = p_document_type)
    and (p_clinical_area is null or p_clinical_area = any(coalesce(nullif(dc.clinical_areas, '{}'), d.clinical_areas)))
    and (p_source_institution is null or coalesce(dc.source_institution, d.source_institution) = p_source_institution)
    and (p_clinical_areas is null or coalesce(nullif(dc.clinical_areas, '{}'), d.clinical_areas) && p_clinical_areas)
    and (p_source_institutions is null or coalesce(dc.source_institution, d.source_institution) = any(p_source_institutions))
    and (
      p_year_from is null
      or (d.year ~ '^[0-9]{4}$' and (d.year)::int >= p_year_from)
    )
    and dc.embedding is not null
  order by dc.embedding::extensions.vector <=> query_embedding::extensions.vector
  limit match_count;
$$;