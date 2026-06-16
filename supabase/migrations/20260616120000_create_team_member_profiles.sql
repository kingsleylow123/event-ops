-- Team member onboarding survey: personal/contact/payroll details for ops team.
-- Distinct from public.team_members (the per-event roster of speakers/facilitators).
create table if not exists public.team_member_profiles (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text not null,
  email text not null,
  instagram_url text not null,
  github_username text not null,
  telegram_username text not null,
  telegram_id text not null,
  bank_account_name text not null,
  bank_name text not null,
  bank_account_number text not null,
  company_name text,
  portfolio_url text,
  created_at timestamptz default now()
);

create index if not exists team_member_profiles_email_idx on public.team_member_profiles (lower(email));
create index if not exists team_member_profiles_created_at_idx on public.team_member_profiles (created_at desc);

alter table public.team_member_profiles enable row level security;

-- API writes go through service-role (supabaseAdmin) so no anon insert policy is needed.
-- Authenticated reads are also via service-role from the admin route. RLS stays on with
-- no permissive policies = locked by default to anything not using the service key.
