alter table public.documents add column if not exists evidence_level text check (evidence_level in (
  'meta_analisis','revision_sistematica','ensayo_clinico_rct','estudio_cohorte','guia_practica_clinica','consenso_expertos','reporte_caso','opinion_experto','otro'
));
alter table public.documents add column if not exists citations_count integer;
alter table public.documents add column if not exists impact_factor numeric(6,3);
alter table public.documents add column if not exists geographic_relevance text check (geographic_relevance in ('chile','latinoamerica','internacional')) default 'internacional';
alter table public.document_chunks add column if not exists evidence_level text;
alter table public.document_chunks add column if not exists geographic_relevance text;