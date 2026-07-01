-- Public events calendar (/events): marketing + phase fields on events, plus a
-- waitlist table for the "Notify me" capture. All additive + nullable so existing
-- ops queries are untouched.

alter table events add column if not exists is_published boolean not null default false;
alter table events add column if not exists current_phase text; -- waitlist|super_early_bird|early_bird|public|sold_out (manual)
alter table events add column if not exists public_listing jsonb; -- marketing payload (see lib/supabase.ts PublicListing)

create table if not exists event_waitlist (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete cascade,
  name text,
  email text,
  phone text,
  source text default 'events_page',
  created_at timestamptz not null default now()
);

-- Service-role API does the inserts; enable RLS with no public policies so the
-- table is closed to the anon key by default.
alter table event_waitlist enable row level security;
