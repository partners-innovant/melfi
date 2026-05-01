alter table public.profiles add column if not exists google_calendar_token jsonb;
alter table public.profiles add column if not exists google_calendar_id text;
alter table public.sessions add column if not exists google_event_id text;