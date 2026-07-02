-- AI C-Suite v3 — persist the grilling per head (for the Boardroom view).
-- The manager's verdict/critique previously lived only in the state snapshot;
-- the visual boardroom needs them per opinion row. Additive only.

alter table public.c_suite_opinions
  add column if not exists manager_verdict text,     -- APPROVE | REJECT (final verdict; revised=true means it was rejected in round 1)
  add column if not exists manager_critique text,
  add column if not exists cross_flags jsonb not null default '[]'::jsonb;
