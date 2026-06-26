-- Jarvis agent: observability + Telegram update dedup + PII audit.
-- All additive. RLS enabled with no policies → service-role only (the bot uses
-- supabaseAdmin, which bypasses RLS), matching every other table in this project.

-- Telegram webhook dedup: Telegram resends an update if it doesn't get a fast
-- 200. The bot now acks immediately and processes in the background, so a retry
-- could double-run. We record each update_id here and skip ones we've seen.
create table if not exists telegram_updates (
  update_id   bigint      primary key,
  chat_id     bigint,
  created_at  timestamptz not null default now()
);
create index if not exists telegram_updates_created_at_idx on telegram_updates (created_at desc);
alter table telegram_updates enable row level security;

-- Every agent tool call: what was asked, how slow, did it error.
create table if not exists jarvis_tool_calls (
  id             uuid        primary key default gen_random_uuid(),
  run_id         uuid,
  chat_id        bigint,
  tool_name      text        not null,
  args           jsonb       not null default '{}',
  result_summary text,
  latency_ms     integer,
  error          text,
  model          text,
  iteration      integer,
  created_at     timestamptz not null default now()
);
create index if not exists jarvis_tool_calls_run_id_idx     on jarvis_tool_calls (run_id);
create index if not exists jarvis_tool_calls_tool_name_idx  on jarvis_tool_calls (tool_name);
create index if not exists jarvis_tool_calls_created_at_idx on jarvis_tool_calls (created_at desc);
alter table jarvis_tool_calls enable row level security;

-- Forensic audit of sensitive reads (e.g. team-member bank account numbers).
create table if not exists jarvis_audit_log (
  id           uuid        primary key default gen_random_uuid(),
  chat_id      bigint,
  action       text        not null,
  query        text,
  result_count integer,
  created_at   timestamptz not null default now()
);
create index if not exists jarvis_audit_log_action_idx     on jarvis_audit_log (action);
create index if not exists jarvis_audit_log_created_at_idx on jarvis_audit_log (created_at desc);
alter table jarvis_audit_log enable row level security;
