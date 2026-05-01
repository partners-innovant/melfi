create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  psychologist_id uuid not null references public.profiles(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete cascade,
  child_patient_id uuid references public.child_patients(id) on delete cascade,
  session_number integer,
  session_date date not null,
  duration_minutes integer default 50,
  status text check (status in ('programada', 'realizada', 'cancelada', 'no_asistió')) default 'programada',
  pre_session_notes text,
  pre_session_suggestions text,
  emotional_state text check (emotional_state in ('muy_bajo', 'bajo', 'moderado', 'bueno', 'muy_bueno')),
  what_happened text,
  interventions_used text,
  assigned_task text,
  next_session_plan text,
  post_session_notes text,
  profile_update_suggestions jsonb,
  created_at timestamptz not null default now(),
  constraint only_one_patient check (
    (patient_id is null) != (child_patient_id is null)
  )
);

create index sessions_patient_idx on public.sessions(patient_id) where patient_id is not null;
create index sessions_child_idx on public.sessions(child_patient_id) where child_patient_id is not null;
create index sessions_psy_idx on public.sessions(psychologist_id);

alter table public.sessions enable row level security;

create policy "Own sessions" on public.sessions for all
  using (auth.uid() = psychologist_id) with check (auth.uid() = psychologist_id);

-- Auto-assign session_number per patient
create or replace function public.set_session_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_n integer;
begin
  if new.session_number is null then
    if new.patient_id is not null then
      select coalesce(max(session_number), 0) + 1 into next_n
      from public.sessions where patient_id = new.patient_id;
    else
      select coalesce(max(session_number), 0) + 1 into next_n
      from public.sessions where child_patient_id = new.child_patient_id;
    end if;
    new.session_number := next_n;
  end if;
  return new;
end;
$$;

create trigger sessions_set_number
before insert on public.sessions
for each row execute function public.set_session_number();