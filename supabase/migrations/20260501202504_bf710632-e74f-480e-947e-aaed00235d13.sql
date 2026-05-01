alter table public.documents
  add column if not exists import_source text
  default 'upload';

-- Add check constraint separately so re-runs are safe
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'documents_import_source_check'
  ) then
    alter table public.documents
      add constraint documents_import_source_check
      check (import_source in ('upload', 'google_drive', 'url', 'web_search'));
  end if;
end $$;

-- Backfill existing rows: rows with a source_url were imported from URL,
-- everything else assumed to be manual upload.
update public.documents
set import_source = case
  when source_url is not null and source_url <> '' then 'url'
  else 'upload'
end
where import_source is null;