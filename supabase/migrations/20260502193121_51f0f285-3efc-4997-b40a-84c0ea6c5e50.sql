alter table public.documents
  add column if not exists pubmed_id text,
  add column if not exists pmc_id text,
  add column if not exists abstract text;

create index if not exists documents_pubmed_id_idx on public.documents (pubmed_id);

-- Allow 'pubmed' as an import_source value
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'documents_import_source_check') then
    alter table public.documents drop constraint documents_import_source_check;
  end if;
  alter table public.documents
    add constraint documents_import_source_check
    check (import_source in ('upload', 'google_drive', 'url', 'web_search', 'pubmed'));
end $$;