-- Profile builder chat
create table public.patient_profile_chat (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  psychologist_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('assistant', 'user')),
  content text not null,
  created_at timestamptz not null default now()
);
create index idx_patient_profile_chat_patient on public.patient_profile_chat(patient_id, created_at);
alter table public.patient_profile_chat enable row level security;
create policy "Own profile chat" on public.patient_profile_chat
  for all using (auth.uid() = psychologist_id) with check (auth.uid() = psychologist_id);

-- Adult documents
create table public.adult_documents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  psychologist_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  document_type text check (document_type in (
    'informe_psicologico','informe_neurologico','informe_psiquiatrico',
    'evaluacion_externa','informe_medico','informe_laboral','otro'
  )),
  professional_name text,
  professional_role text,
  document_date date,
  file_path text,
  notes text,
  created_at timestamptz not null default now()
);
create index idx_adult_documents_patient on public.adult_documents(patient_id);
alter table public.adult_documents enable row level security;
create policy "Own adult_documents" on public.adult_documents
  for all using (auth.uid() = psychologist_id) with check (auth.uid() = psychologist_id);

-- Extend patients with builder fields
alter table public.patients
  add column if not exists presenting_problem text,
  add column if not exists clinical_history text,
  add column if not exists family_context text,
  add column if not exists work_context text,
  add column if not exists previous_treatments text,
  add column if not exists relevant_history text,
  add column if not exists personal_resources text,
  add column if not exists therapeutic_goals text,
  add column if not exists profile_builder_completed boolean not null default false;

-- Storage bucket for adult patient files
insert into storage.buckets (id, name, public) values ('adult-files', 'adult-files', false)
on conflict (id) do nothing;

create policy "Psychologists read own adult files" on storage.objects
  for select using (bucket_id = 'adult-files' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "Psychologists upload own adult files" on storage.objects
  for insert with check (bucket_id = 'adult-files' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "Psychologists update own adult files" on storage.objects
  for update using (bucket_id = 'adult-files' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "Psychologists delete own adult files" on storage.objects
  for delete using (bucket_id = 'adult-files' and auth.uid()::text = (storage.foldername(name))[1]);