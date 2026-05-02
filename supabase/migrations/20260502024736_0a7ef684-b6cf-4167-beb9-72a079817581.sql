-- ============ child_documents ============
create table public.child_documents (
  id uuid primary key default gen_random_uuid(),
  child_patient_id uuid not null references public.child_patients(id) on delete cascade,
  psychologist_id uuid not null,
  title text not null,
  document_type text check (document_type in (
    'informe_psicologico',
    'informe_neurologico',
    'informe_pedagogico',
    'informe_fonoaudiologico',
    'informe_terapia_ocupacional',
    'informe_psiquiatrico',
    'evaluacion_externa',
    'otro'
  )),
  professional_name text,
  professional_role text,
  document_date date,
  file_path text,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.child_documents enable row level security;

create policy "Own child_documents"
on public.child_documents
for all
using (auth.uid() = psychologist_id)
with check (auth.uid() = psychologist_id);

create index idx_child_documents_child on public.child_documents(child_patient_id);

-- ============ child_session_notes ============
create table public.child_session_notes (
  id uuid primary key default gen_random_uuid(),
  child_patient_id uuid not null references public.child_patients(id) on delete cascade,
  psychologist_id uuid not null,
  session_date date not null,
  session_number integer,
  raw_notes text not null,
  refined_notes text,
  emotional_state text check (emotional_state in ('muy_bajo','bajo','moderado','bueno','muy_bueno')),
  techniques_used text,
  assigned_task text,
  next_session_plan text,
  profile_update_suggestions jsonb,
  created_at timestamptz not null default now()
);

alter table public.child_session_notes enable row level security;

create policy "Own child_session_notes"
on public.child_session_notes
for all
using (auth.uid() = psychologist_id)
with check (auth.uid() = psychologist_id);

create index idx_child_session_notes_child on public.child_session_notes(child_patient_id);

-- ============ child_tests ============
create table public.child_tests (
  id uuid primary key default gen_random_uuid(),
  child_patient_id uuid not null references public.child_patients(id) on delete cascade,
  psychologist_id uuid not null,
  test_name text not null,
  test_type text check (test_type in (
    'wisc',
    'htp',
    'figura_humana',
    'familia',
    'persona_bajo_lluvia',
    'bender',
    'conners',
    'beck',
    'raven',
    'vineland',
    'abc_shadow',
    'otro'
  )),
  evaluation_date date not null,
  results_raw text,
  results_structured jsonb,
  generated_report text,
  report_pdf_path text,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.child_tests enable row level security;

create policy "Own child_tests"
on public.child_tests
for all
using (auth.uid() = psychologist_id)
with check (auth.uid() = psychologist_id);

create index idx_child_tests_child on public.child_tests(child_patient_id);

-- ============ Storage bucket: child-files (private) ============
insert into storage.buckets (id, name, public)
values ('child-files', 'child-files', false)
on conflict (id) do nothing;

create policy "child-files read own"
on storage.objects for select
using (bucket_id = 'child-files' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "child-files insert own"
on storage.objects for insert
with check (bucket_id = 'child-files' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "child-files update own"
on storage.objects for update
using (bucket_id = 'child-files' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "child-files delete own"
on storage.objects for delete
using (bucket_id = 'child-files' and auth.uid()::text = (storage.foldername(name))[1]);
