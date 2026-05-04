create table public.professional_feedback (
  id uuid primary key default gen_random_uuid(),
  psychologist_id uuid not null references public.profiles(id) on delete cascade,
  feedback_type text not null check (feedback_type in ('sesion','paciente','global')),
  patient_id uuid references public.patients(id) on delete set null,
  child_patient_id uuid references public.child_patients(id) on delete set null,
  session_id uuid references public.sessions(id) on delete set null,
  date_from date,
  date_to date,
  analysis_input jsonb,
  feedback_content jsonb,
  created_at timestamptz not null default now()
);

alter table public.professional_feedback enable row level security;

create policy "Own professional_feedback select" on public.professional_feedback
  for select using (auth.uid() = psychologist_id);
create policy "Own professional_feedback insert" on public.professional_feedback
  for insert with check (auth.uid() = psychologist_id);
create policy "Own professional_feedback update" on public.professional_feedback
  for update using (auth.uid() = psychologist_id);
create policy "Own professional_feedback delete" on public.professional_feedback
  for delete using (auth.uid() = psychologist_id);

create index idx_professional_feedback_psy on public.professional_feedback(psychologist_id, created_at desc);