create table public.response_feedback (
  id uuid primary key default gen_random_uuid(),
  psychologist_id uuid not null references public.profiles(id) on delete cascade,
  consultation_id uuid references public.consultations(id) on delete cascade,
  question text not null,
  answer text not null,
  rating text not null check (rating in ('util', 'no_util')),
  comment text,
  created_at timestamptz not null default now()
);

create index idx_response_feedback_created_at on public.response_feedback (created_at desc);
create index idx_response_feedback_psychologist on public.response_feedback (psychologist_id);

alter table public.response_feedback enable row level security;

create policy "Users insert own response feedback"
on public.response_feedback for insert
with check (auth.uid() = psychologist_id);

create policy "Users view own response feedback"
on public.response_feedback for select
using (auth.uid() = psychologist_id);

create policy "Admins view all response feedback"
on public.response_feedback for select
using (public.is_admin(auth.uid()));

create policy "Admins delete response feedback"
on public.response_feedback for delete
using (public.is_admin(auth.uid()));
