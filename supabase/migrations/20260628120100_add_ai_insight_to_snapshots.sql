-- Funnel Command Center: cache the daily AI "standing insight" (the constraint +
-- one action + RM upside) so the in-app card reads instantly with no Anthropic
-- call on page load. The digest cron computes + writes this once per day.
alter table public.jarvis_daily_snapshots add column if not exists ai_insight text;
