alter table events
  add column if not exists host_name text,
  add column if not exists host_phone text,
  add column if not exists facilitator_name text,
  add column if not exists facilitator_phone text,
  add column if not exists content_creator_name text,
  add column if not exists content_creator_phone text;
