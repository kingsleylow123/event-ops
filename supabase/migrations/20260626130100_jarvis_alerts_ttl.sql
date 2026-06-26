-- Turn jarvis_alerts from fire-once dedup into TTL-snooze + severity. The
-- existing UNIQUE(event_id, kind, ref) supports the ON CONFLICT upsert. Additive.
alter table jarvis_alerts
  add column if not exists fired_at     timestamptz,
  add column if not exists snooze_until timestamptz,
  add column if not exists severity     text;
