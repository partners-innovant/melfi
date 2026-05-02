create table public.treatment_team (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid,
  child_patient_id uuid,
  psychologist_id uuid not null,
  professional_name text not null,
  professional_role text not null,
  specialty text,
  institution text,
  email text,
  phone text,
  address text,
  notes text,
  is_primary_contact boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.treatment_team enable row level security;

create policy "Own treatment_team"
on public.treatment_team
for all
using (auth.uid() = psychologist_id)
with check (auth.uid() = psychologist_id);

create index idx_treatment_team_patient on public.treatment_team(patient_id);
create index idx_treatment_team_child on public.treatment_team(child_patient_id);
create index idx_treatment_team_psy on public.treatment_team(psychologist_id);