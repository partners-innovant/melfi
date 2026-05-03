-- Abstracts table
CREATE TABLE public.abstracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  psychologist_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_global boolean NOT NULL DEFAULT false,
  title text NOT NULL,
  authors text,
  journal text,
  year integer,
  publication_date date,
  abstract_text text NOT NULL,
  doi text,
  pubmed_id text,
  pmc_id text,
  europepmc_id text,
  source_url text,
  repository text DEFAULT 'PubMed / EuropePMC',
  clinical_areas text[] NOT NULL DEFAULT '{}',
  evidence_level text CHECK (evidence_level IN (
    'meta_analisis','revision_sistematica','ensayo_clinico_rct',
    'estudio_cohorte','guia_practica_clinica','consenso_expertos',
    'reporte_caso','opinion_experto','otro'
  )),
  geographic_relevance text CHECK (geographic_relevance IN ('chile','latinoamerica','internacional')) DEFAULT 'internacional',
  citations_count integer DEFAULT 0,
  language text CHECK (language IN ('español','ingles','otro')) DEFAULT 'ingles',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.abstract_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  abstract_id uuid NOT NULL REFERENCES public.abstracts(id) ON DELETE CASCADE,
  psychologist_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_global boolean NOT NULL DEFAULT false,
  content text NOT NULL,
  embedding extensions.vector(1024),
  clinical_areas text[] NOT NULL DEFAULT '{}',
  evidence_level text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.abstracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.abstract_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View global or own abstracts" ON public.abstracts
  FOR SELECT USING (is_global = true OR auth.uid() = psychologist_id);

CREATE POLICY "Insert own abstracts (admins for global)" ON public.abstracts
  FOR INSERT WITH CHECK (
    auth.uid() = psychologist_id
    AND (is_global = false OR public.is_admin(auth.uid()))
  );

CREATE POLICY "Update own abstracts" ON public.abstracts
  FOR UPDATE USING (auth.uid() = psychologist_id);

CREATE POLICY "Delete own or global as admin" ON public.abstracts
  FOR DELETE USING (
    (auth.uid() = psychologist_id AND is_global = false)
    OR public.is_admin(auth.uid())
  );

CREATE POLICY "View chunks of accessible abstracts" ON public.abstract_chunks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.abstracts a
      WHERE a.id = abstract_chunks.abstract_id
        AND (a.is_global = true OR a.psychologist_id = auth.uid())
    )
  );

CREATE POLICY "Insert own chunks" ON public.abstract_chunks
  FOR INSERT WITH CHECK (auth.uid() = psychologist_id);

CREATE POLICY "Delete own chunks" ON public.abstract_chunks
  FOR DELETE USING (auth.uid() = psychologist_id OR public.is_admin(auth.uid()));

-- Indexes
CREATE INDEX abstract_chunks_embedding_idx ON public.abstract_chunks
  USING ivfflat (embedding extensions.vector_cosine_ops);
CREATE INDEX abstracts_psychologist_idx ON public.abstracts(psychologist_id);
CREATE INDEX abstract_chunks_abstract_idx ON public.abstract_chunks(abstract_id);

-- Combined search across documents + abstracts
CREATE OR REPLACE FUNCTION public.match_all_chunks(
  query_embedding extensions.vector,
  match_count integer DEFAULT 5,
  p_psychologist_id uuid DEFAULT NULL,
  p_clinical_area text DEFAULT NULL,
  p_source_institution text DEFAULT NULL,
  p_year_from integer DEFAULT NULL,
  p_clinical_areas text[] DEFAULT NULL,
  p_source_institutions text[] DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  content text,
  source_type text,
  document_id uuid,
  abstract_id uuid,
  page_number integer,
  is_global boolean,
  document_type text,
  clinical_areas text[],
  source_institution text,
  similarity double precision
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  (
    SELECT
      dc.id,
      dc.content,
      'document'::text AS source_type,
      dc.document_id,
      NULL::uuid AS abstract_id,
      dc.page_number,
      COALESCE(dc.is_global, d.is_global) AS is_global,
      COALESCE(dc.document_type, d.document_type) AS document_type,
      COALESCE(NULLIF(dc.clinical_areas, '{}'), d.clinical_areas) AS clinical_areas,
      COALESCE(dc.source_institution, d.source_institution) AS source_institution,
      1 - (dc.embedding::extensions.vector <=> query_embedding::extensions.vector) AS similarity
    FROM public.document_chunks dc
    JOIN public.documents d ON d.id = dc.document_id
    WHERE (d.is_global = true OR d.psychologist_id = p_psychologist_id)
      AND (p_clinical_area IS NULL OR p_clinical_area = ANY(COALESCE(NULLIF(dc.clinical_areas, '{}'), d.clinical_areas)))
      AND (p_source_institution IS NULL OR COALESCE(dc.source_institution, d.source_institution) = p_source_institution)
      AND (p_clinical_areas IS NULL OR COALESCE(NULLIF(dc.clinical_areas, '{}'), d.clinical_areas) && p_clinical_areas)
      AND (p_source_institutions IS NULL OR COALESCE(dc.source_institution, d.source_institution) = ANY(p_source_institutions))
      AND (p_year_from IS NULL OR (d.year ~ '^[0-9]{4}$' AND (d.year)::int >= p_year_from))
      AND dc.embedding IS NOT NULL
  )
  UNION ALL
  (
    SELECT
      ac.id,
      ac.content,
      'abstract'::text AS source_type,
      NULL::uuid AS document_id,
      ac.abstract_id,
      1 AS page_number,
      COALESCE(ac.is_global, a.is_global) AS is_global,
      NULL::text AS document_type,
      COALESCE(NULLIF(ac.clinical_areas, '{}'), a.clinical_areas) AS clinical_areas,
      a.journal AS source_institution,
      1 - (ac.embedding::extensions.vector <=> query_embedding::extensions.vector) AS similarity
    FROM public.abstract_chunks ac
    JOIN public.abstracts a ON a.id = ac.abstract_id
    WHERE (a.is_global = true OR a.psychologist_id = p_psychologist_id)
      AND (p_clinical_area IS NULL OR p_clinical_area = ANY(COALESCE(NULLIF(ac.clinical_areas, '{}'), a.clinical_areas)))
      AND (p_clinical_areas IS NULL OR COALESCE(NULLIF(ac.clinical_areas, '{}'), a.clinical_areas) && p_clinical_areas)
      AND (p_year_from IS NULL OR a.year >= p_year_from)
      AND ac.embedding IS NOT NULL
  )
  ORDER BY similarity DESC
  LIMIT match_count;
$$;