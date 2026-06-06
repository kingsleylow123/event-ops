-- Jarvis conversation memory: stores recent turns and any pending action
-- per Telegram chat_id. Service-role only — no anon access.

create table if not exists jarvis_conversations (
  chat_id    bigint      primary key,
  turns      jsonb       not null default '[]'::jsonb,
  pending    jsonb,
  updated_at timestamptz not null default now()
);

alter table jarvis_conversations enable row level security;
-- No anon policy — all access via service-role client (bypasses RLS).
