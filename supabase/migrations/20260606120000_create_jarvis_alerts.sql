create table if not exists jarvis_alerts (
  id         uuid        primary key default gen_random_uuid(),
  event_id   uuid        not null references events(id) on delete cascade,
  kind       text        not null,
  ref        text        not null,
  created_at timestamptz not null default now(),
  constraint jarvis_alerts_event_kind_ref_key unique (event_id, kind, ref)
);

create index if not exists jarvis_alerts_event_id_idx on jarvis_alerts (event_id);
create index if not exists jarvis_alerts_kind_idx on jarvis_alerts (kind);

alter table jarvis_alerts enable row level security;
-- No anon policy: service-role only (mirrors all other event-ops tables).
-- Add explicit policies here if anon/authenticated access is ever needed.
