alter table public.abstracts add column if not exists source_institution text;
alter table public.abstracts add column if not exists repository_id text;
alter table public.abstracts add column if not exists impact_factor numeric(6,3);
alter table public.abstracts add column if not exists document_type text default 'articulo_cientifico';
alter table public.abstracts add column if not exists relevance_score numeric(5,2);

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'abstracts_document_type_check'
  ) then
    alter table public.abstracts add constraint abstracts_document_type_check
      check (document_type in (
        'articulo_cientifico','revision_sistematica','meta_analisis',
        'ensayo_clinico_rct','guia_practica_clinica','libro_academico',
        'informe_consenso','otro'
      ));
  end if;
end $$;