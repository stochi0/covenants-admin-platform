alter table public.companies add column if not exists deleted_at timestamptz;
alter table public.regions add column if not exists deleted_at timestamptz;
alter table public.chemistries add column if not exists deleted_at timestamptz;
alter table public.accreditations add column if not exists deleted_at timestamptz;
alter table public.controlled_substances add column if not exists deleted_at timestamptz;
