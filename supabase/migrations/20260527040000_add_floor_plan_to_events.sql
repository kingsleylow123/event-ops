alter table events
  add column if not exists floor_plan jsonb not null default '{"sections": []}'::jsonb;
