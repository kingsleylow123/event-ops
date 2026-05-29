create table if not exists weekly_activity (
  id uuid primary key default gen_random_uuid(),
  person_name text not null,
  week_start date not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (person_name, week_start)
);

create index if not exists weekly_activity_week_idx on weekly_activity (week_start desc);
create index if not exists weekly_activity_person_idx on weekly_activity (lower(person_name));
