-- Enable pgvector
create extension if not exists vector;

-- profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  rut text,
  phone text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- patients
create table public.patients (
  id uuid primary key default gen_random_uuid(),
  psychologist_id uuid not null references auth.users(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  birth_date date,
  sex text check (sex in ('hombre','mujer')),
  marital_status text check (marital_status in ('soltero/a','casado/a','divorciado/a','viudo/a','conviviente')),
  occupation text,
  start_date date,
  diagnosis text,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.patients enable row level security;

create policy "Psychologists manage their patients"
  on public.patients for all
  using (auth.uid() = psychologist_id)
  with check (auth.uid() = psychologist_id);

-- documents
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  psychologist_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  author text,
  year text,
  is_global boolean not null default false,
  document_type text not null check (document_type in (
    'articulo_cientifico','guia_clinica','manual_diagnostico',
    'libro_academico','codigo_etico','informe_consenso','otro'
  )),
  created_at timestamptz not null default now()
);

alter table public.documents enable row level security;

-- helper: is_admin check (security definer to avoid recursion)
create or replace function public.is_admin(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = _user_id), false);
$$;

create policy "View global or own documents"
  on public.documents for select
  using (is_global = true or auth.uid() = psychologist_id);

create policy "Insert own documents (admins for global)"
  on public.documents for insert
  with check (
    auth.uid() = psychologist_id
    and (is_global = false or public.is_admin(auth.uid()))
  );

create policy "Delete own documents"
  on public.documents for delete
  using (auth.uid() = psychologist_id and is_global = false);

create policy "Update own documents"
  on public.documents for update
  using (auth.uid() = psychologist_id);

-- document_chunks
create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  psychologist_id uuid not null references auth.users(id) on delete cascade,
  chunk_index int not null,
  content text not null,
  page_number int,
  embedding vector(1024),
  created_at timestamptz not null default now()
);

create index document_chunks_embedding_idx on public.document_chunks
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index document_chunks_document_idx on public.document_chunks(document_id);

alter table public.document_chunks enable row level security;

create policy "View chunks of accessible documents"
  on public.document_chunks for select
  using (
    exists (
      select 1 from public.documents d
      where d.id = document_chunks.document_id
        and (d.is_global = true or d.psychologist_id = auth.uid())
    )
  );

create policy "Insert own chunks"
  on public.document_chunks for insert
  with check (auth.uid() = psychologist_id);

create policy "Delete own chunks"
  on public.document_chunks for delete
  using (auth.uid() = psychologist_id);

-- consultations
create table public.consultations (
  id uuid primary key default gen_random_uuid(),
  psychologist_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete set null,
  question text not null,
  answer text not null,
  citations jsonb not null default '[]'::jsonb,
  document_type_filter text,
  created_at timestamptz not null default now()
);

alter table public.consultations enable row level security;

create policy "Psychologists manage their consultations"
  on public.consultations for all
  using (auth.uid() = psychologist_id)
  with check (auth.uid() = psychologist_id);

-- match_chunks RPC
create or replace function public.match_chunks(
  query_embedding vector(1024),
  match_count int default 5,
  p_psychologist_id uuid default null,
  p_document_type text default null
)
returns table (
  id uuid,
  document_id uuid,
  content text,
  page_number int,
  chunk_index int,
  similarity float
)
language sql
stable
security definer
set search_path = public
as $$
  select
    dc.id,
    dc.document_id,
    dc.content,
    dc.page_number,
    dc.chunk_index,
    1 - (dc.embedding <=> query_embedding) as similarity
  from public.document_chunks dc
  join public.documents d on d.id = dc.document_id
  where (d.is_global = true or d.psychologist_id = p_psychologist_id)
    and (p_document_type is null or d.document_type = p_document_type)
    and dc.embedding is not null
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, first_name, last_name, rut, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    new.raw_user_meta_data->>'rut',
    new.raw_user_meta_data->>'phone'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();