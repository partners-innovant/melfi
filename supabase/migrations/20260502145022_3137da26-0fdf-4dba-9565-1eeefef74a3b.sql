alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists specialty text;
alter table public.profiles add column if not exists secondary_specialty text;
alter table public.profiles add column if not exists theoretical_approach text[];
alter table public.profiles add column if not exists years_experience integer;
alter table public.profiles add column if not exists license_number text;
alter table public.profiles add column if not exists university text;
alter table public.profiles add column if not exists graduation_year integer;
alter table public.profiles add column if not exists postgraduate text;
alter table public.profiles add column if not exists institution text;
alter table public.profiles add column if not exists city text;
alter table public.profiles add column if not exists region text;
alter table public.profiles add column if not exists website text;
alter table public.profiles add column if not exists linkedin text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists default_session_duration integer default 50;
alter table public.profiles add column if not exists default_session_frequency text default 'semanal';

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "Avatar images are publicly accessible"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "Users upload own avatar"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users update own avatar"
  on storage.objects for update
  using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users delete own avatar"
  on storage.objects for delete
  using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);