alter table events add column if not exists team jsonb not null default '[]'::jsonb;

-- Backfill team array from the legacy single-member columns where the new team array is still empty
update events set team = (
  select coalesce(jsonb_agg(member), '[]'::jsonb)
  from (
    select jsonb_build_object('role', 'host', 'name', host_name, 'phone', host_phone) as member
      where host_name is not null and host_name <> ''
    union all
    select jsonb_build_object('role', 'facilitator', 'name', facilitator_name, 'phone', facilitator_phone)
      where facilitator_name is not null and facilitator_name <> ''
    union all
    select jsonb_build_object('role', 'content_creator', 'name', content_creator_name, 'phone', content_creator_phone)
      where content_creator_name is not null and content_creator_name <> ''
  ) members
)
where team = '[]'::jsonb;
