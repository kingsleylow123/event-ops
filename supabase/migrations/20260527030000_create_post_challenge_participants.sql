create table if not exists post_challenge_participants (
  name text primary key,
  created_at timestamptz not null default now()
);

-- Seed with initial 3 participants
insert into post_challenge_participants (name) values ('Chloe'), ('Quennie'), ('Guan')
on conflict (name) do nothing;
