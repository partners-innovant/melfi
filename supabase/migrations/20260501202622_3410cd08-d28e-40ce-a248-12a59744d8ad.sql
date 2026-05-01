drop policy if exists "Insert own documents (admins for global)" on public.documents;

create policy "Insert own documents (admins for global)"
on public.documents
for insert
with check (
  auth.uid() = psychologist_id
  and (
    is_global = false
    or is_admin(auth.uid())
    or import_source = 'web_search'
  )
);