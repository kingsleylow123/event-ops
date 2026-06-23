-- Facilitator payout: a custom, per-event amount paid to each facilitator,
-- with bank details and a paid/unpaid toggle. Mirrors affiliate_payouts, but
-- keyed by facilitator NAME — facilitators live as `attendees` rows with
-- is_facilitator = true and have no stable id of their own. The /api/facilitator-stats
-- route already dedupes facilitators case-insensitively by name, so we do the same here.
create table if not exists public.facilitator_payouts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  name text not null,
  -- Normalized key for one-row-per-(event, person) dedupe and upsert conflict
  -- target. Matches norm() in the API: lower(trim(name)).
  name_key text generated always as (lower(btrim(name))) stored,
  amount numeric not null default 0,
  bank_name text,
  bank_account text,
  bank_holder text,
  notes text,
  paid_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint facilitator_payouts_event_name_uniq unique (event_id, name_key)
);

create index if not exists facilitator_payouts_event_idx
  on public.facilitator_payouts (event_id);

alter table public.facilitator_payouts enable row level security;
-- Writes go through service-role (supabaseAdmin) from the guarded API route,
-- same as affiliate_payouts / team_member_profiles. RLS on + no permissive
-- policy = locked by default to anything not using the service key.
