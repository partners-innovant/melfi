create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  psychologist_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('sugerencia', 'desarrollo', 'error')),
  title text not null,
  description text not null,
  status text not null default 'nuevo' check (status in ('nuevo', 'en_revision', 'en_desarrollo', 'resuelto')),
  created_at timestamptz not null default now()
);

alter table public.feedback enable row level security;

create policy "Users insert own feedback"
on public.feedback for insert
with check (auth.uid() = psychologist_id);

create policy "Users view own feedback"
on public.feedback for select
using (auth.uid() = psychologist_id);

create policy "Admins view all feedback"
on public.feedback for select
using (public.is_admin(auth.uid()));

create policy "Admins update feedback"
on public.feedback for update
using (public.is_admin(auth.uid()));

create policy "Admins delete feedback"
on public.feedback for delete
using (public.is_admin(auth.uid()));

create index idx_feedback_status on public.feedback(status);
create index idx_feedback_created on public.feedback(created_at desc);