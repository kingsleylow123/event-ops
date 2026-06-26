-- Jarvis memory layer: one metric snapshot per active event per day, written by
-- the digest cron. Gives Jarvis baselines so the digest can speak deltas/trends
-- (deterministic SQL, no LLM). Additive; RLS on (service-role only, like the rest).
create table if not exists jarvis_daily_snapshots (
  id              uuid        primary key default gen_random_uuid(),
  event_id        uuid        not null references events(id) on delete cascade,
  snapshot_date   date        not null,
  registered      integer     not null default 0,
  paid_count      integer     not null default 0,
  free_count      integer     not null default 0,
  gross_revenue   numeric     not null default 0,
  survey_count    integer     not null default 0,
  deals_new       integer     not null default 0,
  deals_contacted integer     not null default 0,
  deals_meeting   integer     not null default 0,
  deals_won       integer     not null default 0,
  created_at      timestamptz not null default now(),
  unique (event_id, snapshot_date)
);
create index if not exists jarvis_daily_snapshots_event_idx on jarvis_daily_snapshots (event_id, snapshot_date desc);
alter table jarvis_daily_snapshots enable row level security;
