create table if not exists content_posts (
  id uuid primary key default gen_random_uuid(),
  person_name text not null,
  post_date date not null default current_date,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists content_posts_date_idx on content_posts (post_date desc);
create index if not exists content_posts_person_idx on content_posts (lower(person_name));
