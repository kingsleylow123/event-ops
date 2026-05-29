create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  description text not null,
  amount numeric(12, 2) not null check (amount >= 0),
  category text not null default 'Other',
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists expenses_event_id_idx on expenses (event_id);
create index if not exists expenses_category_idx on expenses (category);
