-- Global rates for the Creator Scorecard: one commission % + one team-lead override %
-- (single-row config; change once → applies to all creators).
create table if not exists public.creator_settings (
  id int primary key default 1,
  commission_rate numeric not null default 0.10,  -- creator commission, % of attributed revenue
  override_rate   numeric not null default 0.05,  -- team-lead override, % of each creator's revenue
  updated_at timestamptz not null default now(),
  constraint creator_settings_singleton check (id = 1)
);
insert into public.creator_settings (id) values (1) on conflict (id) do nothing;
alter table public.creator_settings enable row level security;
