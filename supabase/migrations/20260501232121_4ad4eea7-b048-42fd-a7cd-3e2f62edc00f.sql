create table public.patient_medications (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  psychologist_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  dose text,
  frequency text,
  prescribed_by text,
  start_date date,
  end_date date,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create table public.child_patient_medications (
  id uuid primary key default gen_random_uuid(),
  child_patient_id uuid not null references public.child_patients(id) on delete cascade,
  psychologist_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  dose text,
  frequency text,
  prescribed_by text,
  start_date date,
  end_date date,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.patient_medications enable row level security;
alter table public.child_patient_medications enable row level security;

create policy "Own patient_medications"
  on public.patient_medications for all
  using (auth.uid() = psychologist_id)
  with check (auth.uid() = psychologist_id);

create policy "Own child_patient_medications"
  on public.child_patient_medications for all
  using (auth.uid() = psychologist_id)
  with check (auth.uid() = psychologist_id);

create index idx_patient_medications_patient on public.patient_medications(patient_id);
create index idx_child_patient_medications_child on public.child_patient_medications(child_patient_id);