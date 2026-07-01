-- Ads Council Agent (Claude Malaysia workshop ads-manager-with-council). v1.
-- All tables are server-only: RLS enabled with NO policies, so anon/authenticated
-- have no access; the service-role client (supabase-admin) bypasses RLS and is the
-- sole writer/reader. Additive only — no existing tables touched.
-- Applied live to project hxqpcicdrjgdjabkwlfu on 2026-06-27.

create table if not exists public.ads_council_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  mode text not null default 'copilot',          -- copilot | risk_tiered
  status text not null default 'running',         -- running | done | aborted | error
  ad_account_id text,
  ads_scanned int default 0,
  actions_proposed int default 0,
  actions_auto int default 0,
  dry_run boolean default false,
  note text,
  meta jsonb
);

create table if not exists public.ads_council_actions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.ads_council_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  scope text not null,                            -- ad | adset | campaign
  target_entity_id text not null,
  target_name text,
  action_type text not null,                      -- scale | pause | refresh_creative | shift_budget | test_audience | none | escalate
  proposed_settings jsonb not null default '{}'::jsonb,
  why text,
  supporting_data jsonb not null default '{}'::jsonb,
  confidence int,
  risk_tier text,                                 -- low_reversible | high
  verdict_reason text,
  transcript jsonb,                               -- full debate: each agent's WHY
  status text not null default 'pending',         -- pending | approved | rejected | executed | failed | expired
  decided_by text,
  decided_at timestamptz,
  executed_at timestamptz,
  execution_result jsonb,
  snapshot_id uuid
);
create index if not exists ads_council_actions_status_idx on public.ads_council_actions (status, created_at desc);
create index if not exists ads_council_actions_run_idx on public.ads_council_actions (run_id);

create table if not exists public.ads_council_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  run_id uuid,
  action_id uuid,
  level text not null default 'info',             -- info | warn | error | commit | rollback
  event text not null,
  detail jsonb
);
create index if not exists ads_council_log_created_idx on public.ads_council_log (created_at desc);

create table if not exists public.ads_breaker_state (
  id text primary key,                            -- 'meta:<ad_account_id>'
  open_until timestamptz,
  reason text,
  throttle_count int default 0,
  window_started_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.ads_entity_snapshots (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  action_id uuid,
  scope text not null,
  entity_id text not null,
  prior_state jsonb not null,                     -- {status, daily_budget, ...} before the write
  restored boolean not null default false,
  restored_at timestamptz
);

create table if not exists public.ads_cooldowns (
  entity_id text primary key,
  last_action_type text,
  last_action_at timestamptz not null default now(),
  cooldown_until timestamptz
);

create table if not exists public.ads_policy_memory (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  action_id uuid,
  scope text,
  entity_id text,
  action_type text,
  predicted jsonb,                                -- expected, e.g. {cost_per_dm}
  actual jsonb,                                   -- filled ~3 days later
  measured_at timestamptz,
  verdict text                                    -- held | wrong | inconclusive
);

alter table public.ads_council_runs       enable row level security;
alter table public.ads_council_actions    enable row level security;
alter table public.ads_council_log         enable row level security;
alter table public.ads_breaker_state       enable row level security;
alter table public.ads_entity_snapshots    enable row level security;
alter table public.ads_cooldowns           enable row level security;
alter table public.ads_policy_memory       enable row level security;
