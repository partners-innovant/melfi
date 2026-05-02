create table public.general_conversations (
  id uuid primary key default gen_random_uuid(),
  psychologist_id uuid not null references public.profiles(id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.general_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.general_conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index on public.general_conversations(psychologist_id, updated_at desc);
create index on public.general_messages(conversation_id, created_at);

alter table public.general_conversations enable row level security;
alter table public.general_messages enable row level security;

create policy "Own general conversations"
  on public.general_conversations for all
  using (auth.uid() = psychologist_id)
  with check (auth.uid() = psychologist_id);

create policy "View messages in own conversations"
  on public.general_messages for select
  using (exists (select 1 from public.general_conversations c
                 where c.id = conversation_id and c.psychologist_id = auth.uid()));

create policy "Insert messages in own conversations"
  on public.general_messages for insert
  with check (exists (select 1 from public.general_conversations c
                      where c.id = conversation_id and c.psychologist_id = auth.uid()));

create policy "Delete messages in own conversations"
  on public.general_messages for delete
  using (exists (select 1 from public.general_conversations c
                 where c.id = conversation_id and c.psychologist_id = auth.uid()));