create table if not exists meetings (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  meeting_date timestamptz not null,
  event_id uuid references events(id) on delete set null,
  notes text,
  attendance jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists meetings_date_idx on meetings (meeting_date desc);
create index if not exists meetings_event_idx on meetings (event_id);
