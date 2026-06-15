-- GLCC build registry: one row per opted-in student repo. Metadata only — name,
-- vertical, repo URL, live Vercel URL, last deploy. Written by /api/glcc-student
-- (the opt-in phone-home receiver), read by Insights + the nightly backup script.
create table if not exists public.glcc_students (
  id uuid primary key default gen_random_uuid(),
  repo_url text unique not null,
  name text,
  vertical text,
  vercel_url text,
  last_deploy timestamptz,
  first_seen timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Service-role (supabaseAdmin) bypasses RLS; enabling it with no policies blocks
-- anon/auth clients entirely. The phone-home receiver is the only writer.
alter table public.glcc_students enable row level security;
