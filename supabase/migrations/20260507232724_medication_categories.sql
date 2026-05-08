-- Pivot table separating each medication's therapeutic_class into one or more
-- (family, subgroup) rows. Replaces the practice of parsing the multi-line
-- text column at query time. A medication can belong to multiple families;
-- exactly one row per medication carries is_primary=true (the first family
-- listed in the source vademécum).

create table public.medication_categories (
  id uuid primary key default gen_random_uuid(),
  medication_id uuid not null references public.medications(id) on delete cascade,
  family text not null,
  subgroup text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_medication_categories_medication on public.medication_categories(medication_id);
create index idx_medication_categories_family on public.medication_categories(family);
-- Partial index for the typical "primary family of each medication" query.
create index idx_medication_categories_primary on public.medication_categories(medication_id) where is_primary = true;

-- The vademécum is public reference data (same as medications), so no RLS.
alter table public.medication_categories disable row level security;
