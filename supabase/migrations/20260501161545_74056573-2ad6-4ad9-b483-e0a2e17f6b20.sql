-- Child patients (Infanto-Juvenil)
create table public.child_patients (
  id uuid primary key default gen_random_uuid(),
  psychologist_id uuid not null references public.profiles(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  birth_date date not null,
  sex text check (sex in ('niño', 'niña')),
  school text,
  grade text,
  homeroom_teacher text,
  modality text check (modality in ('regular', 'PIE', 'diferencial')),
  referral_source text check (referral_source in ('colegio', 'padres', 'médico', 'otro')),
  referral_reason text,
  medical_diagnosis text,
  current_medication text,
  specialist_name text,
  notes text,
  created_at timestamptz not null default now()
);

create table public.guardians (
  id uuid primary key default gen_random_uuid(),
  child_patient_id uuid not null references public.child_patients(id) on delete cascade,
  psychologist_id uuid not null references public.profiles(id) on delete cascade,
  full_name text not null,
  relationship text check (relationship in ('madre', 'padre', 'abuela/o', 'tía/o', 'otro')),
  phone text,
  email text,
  involvement_level text check (involvement_level in ('alto', 'medio', 'bajo')),
  created_at timestamptz not null default now()
);

create table public.intervention_goals (
  id uuid primary key default gen_random_uuid(),
  child_patient_id uuid not null references public.child_patients(id) on delete cascade,
  psychologist_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  status text check (status in ('pendiente', 'en_progreso', 'logrado')) default 'pendiente',
  estimated_date date,
  achieved_date date,
  created_at timestamptz not null default now()
);

create table public.goal_tasks (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.intervention_goals(id) on delete cascade,
  child_patient_id uuid not null references public.child_patients(id) on delete cascade,
  psychologist_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  assigned_date date,
  responsible text check (responsible in ('niño/a', 'apoderado', 'colegio', 'psicólogo')),
  status text check (status in ('pendiente', 'realizada', 'no_realizada')) default 'pendiente',
  session_date date,
  created_at timestamptz not null default now()
);

create table public.behavioral_tracking (
  id uuid primary key default gen_random_uuid(),
  child_patient_id uuid not null references public.child_patients(id) on delete cascade,
  psychologist_id uuid not null references public.profiles(id) on delete cascade,
  behavior_name text not null,
  score integer check (score between 1 and 5),
  tracking_date date not null,
  notes text,
  created_at timestamptz not null default now()
);

create table public.wisc_evaluations (
  id uuid primary key default gen_random_uuid(),
  child_patient_id uuid not null references public.child_patients(id) on delete cascade,
  psychologist_id uuid not null references public.profiles(id) on delete cascade,
  version text check (version in ('WISC-IV', 'WISC-V')),
  evaluation_date date not null,
  cit integer,
  icv integer,
  irp integer,
  imt integer,
  ivp integer,
  irf integer,
  observations text,
  report_path text,
  created_at timestamptz not null default now()
);

create table public.other_evaluations (
  id uuid primary key default gen_random_uuid(),
  child_patient_id uuid not null references public.child_patients(id) on delete cascade,
  psychologist_id uuid not null references public.profiles(id) on delete cascade,
  test_name text not null,
  evaluation_date date not null,
  results text,
  observations text,
  report_path text,
  created_at timestamptz not null default now()
);

create table public.communication_log (
  id uuid primary key default gen_random_uuid(),
  child_patient_id uuid not null references public.child_patients(id) on delete cascade,
  psychologist_id uuid not null references public.profiles(id) on delete cascade,
  contact_date date not null,
  contact_type text check (contact_type in ('llamada', 'email', 'reunión', 'citación', 'whatsapp')),
  contact_with text check (contact_with in ('madre', 'padre', 'apoderado', 'profesor_jefe', 'orientador', 'psicólogo_colegio', 'otro')),
  summary text not null,
  agreements text,
  created_at timestamptz not null default now()
);

-- Enable RLS
alter table public.child_patients enable row level security;
alter table public.guardians enable row level security;
alter table public.intervention_goals enable row level security;
alter table public.goal_tasks enable row level security;
alter table public.behavioral_tracking enable row level security;
alter table public.wisc_evaluations enable row level security;
alter table public.other_evaluations enable row level security;
alter table public.communication_log enable row level security;

-- Policies: psychologist owns rows
create policy "Own child_patients" on public.child_patients for all
  using (auth.uid() = psychologist_id) with check (auth.uid() = psychologist_id);
create policy "Own guardians" on public.guardians for all
  using (auth.uid() = psychologist_id) with check (auth.uid() = psychologist_id);
create policy "Own intervention_goals" on public.intervention_goals for all
  using (auth.uid() = psychologist_id) with check (auth.uid() = psychologist_id);
create policy "Own goal_tasks" on public.goal_tasks for all
  using (auth.uid() = psychologist_id) with check (auth.uid() = psychologist_id);
create policy "Own behavioral_tracking" on public.behavioral_tracking for all
  using (auth.uid() = psychologist_id) with check (auth.uid() = psychologist_id);
create policy "Own wisc_evaluations" on public.wisc_evaluations for all
  using (auth.uid() = psychologist_id) with check (auth.uid() = psychologist_id);
create policy "Own other_evaluations" on public.other_evaluations for all
  using (auth.uid() = psychologist_id) with check (auth.uid() = psychologist_id);
create policy "Own communication_log" on public.communication_log for all
  using (auth.uid() = psychologist_id) with check (auth.uid() = psychologist_id);

-- Storage policies for child evaluation reports (reuse 'documents' bucket under child-reports/{user_id}/...)
create policy "Users upload own child reports"
  on storage.objects for insert
  with check (bucket_id = 'documents' and auth.uid()::text = (storage.foldername(name))[2] and (storage.foldername(name))[1] = 'child-reports');

create policy "Users read own child reports"
  on storage.objects for select
  using (bucket_id = 'documents' and auth.uid()::text = (storage.foldername(name))[2] and (storage.foldername(name))[1] = 'child-reports');

create policy "Users delete own child reports"
  on storage.objects for delete
  using (bucket_id = 'documents' and auth.uid()::text = (storage.foldername(name))[2] and (storage.foldername(name))[1] = 'child-reports');