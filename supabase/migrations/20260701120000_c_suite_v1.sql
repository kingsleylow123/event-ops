-- AI C-Suite v1 — Manager (Opus) over 4 department heads (Sales/Ops/Finance/Marketing,
-- Sonnet), each with its own memory; manager grills the heads and synthesises a
-- best-practice ruling. Copilot: recommend-only, nothing executes. Mirrors the
-- ads_council_* convention: all tables server-only (RLS on, NO policies), the
-- service-role client (supabase-admin) is the sole reader/writer. Additive only.

-- One board sitting (nightly | weekly | ondemand).
create table if not exists public.c_suite_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  mode text not null default 'nightly',            -- nightly | weekly | ondemand
  status text not null default 'running',          -- running | done | error
  question text,                                    -- the strategic question, if on-demand
  rounds int default 0,                             -- debate rounds run
  dry_run boolean default false,
  board_brief text,                                 -- the manager's narrative summary
  note text,
  meta jsonb
);

-- Each head's brief for a run (its OWN read + recommendation).
create table if not exists public.c_suite_opinions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.c_suite_runs(id) on delete cascade,
  created_at timestamptz not null default now(),
  dept text not null,                               -- sales | ops | finance | marketing
  headline text,
  top_issue text,
  recommended_move text,
  confidence int,
  evidence jsonb not null default '[]'::jsonb,       -- bullet metrics/facts cited
  data_status text,                                  -- ok | partial:... (provenance/degrade note)
  revised boolean not null default false             -- true if rewritten after a manager REJECT
);
create index if not exists c_suite_opinions_run_idx on public.c_suite_opinions (run_id);

-- The manager's rulings for a run (best-practice decisions).
create table if not exists public.c_suite_decisions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.c_suite_runs(id) on delete cascade,
  created_at timestamptz not null default now(),
  title text,
  decision text,
  rationale text,
  overruled jsonb not null default '[]'::jsonb,       -- which heads/positions were overruled + why
  priority text,                                      -- high | medium | low
  confidence int
);
create index if not exists c_suite_decisions_run_idx on public.c_suite_decisions (run_id);

-- Per-head durable memory (agent_id scope). Loaded at the start of every run so
-- it's not groundhog day; a distilled learning is written back after each run.
create table if not exists public.c_suite_head_memory (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  dept text not null,                                -- the head this memory belongs to
  learning text not null,                            -- one distilled learning
  run_id uuid
);
create index if not exists c_suite_head_memory_dept_idx on public.c_suite_head_memory (dept, created_at desc);

-- Shared org context (app_id scope) every head reads — live KPIs, current batch,
-- priorities. Append-only-ish: a single curated row, seeded here, editable later.
create table if not exists public.c_suite_company_context (
  id text primary key,                               -- 'default'
  context jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.c_suite_company_context (id, context)
  values ('default', '{"mission":"Get 10,000 Malaysians making more money with AI","priorities":["Fill workshops","Convert attendees to BoFu implementation calls","Keep margin healthy"]}'::jsonb)
  on conflict (id) do nothing;

-- Predicted vs actual (learns over time), mirrors ads_policy_memory.
create table if not exists public.c_suite_outcomes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  run_id uuid,
  dept text,
  predicted jsonb,                                   -- {recommended_move, confidence}
  actual jsonb,                                      -- filled later
  measured_at timestamptz,
  verdict text                                       -- held | wrong | inconclusive
);

-- Snapshot of the whole board between runs (save_state/load_state) so a stateless
-- runtime has a continuous, resumable board.
create table if not exists public.c_suite_state (
  id text primary key,                               -- one row per mode: 'nightly' | 'weekly'
  mode text,
  snapshot jsonb,
  updated_at timestamptz not null default now()
);

alter table public.c_suite_runs             enable row level security;
alter table public.c_suite_opinions         enable row level security;
alter table public.c_suite_decisions        enable row level security;
alter table public.c_suite_head_memory      enable row level security;
alter table public.c_suite_company_context  enable row level security;
alter table public.c_suite_outcomes         enable row level security;
alter table public.c_suite_state            enable row level security;
