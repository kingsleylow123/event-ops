-- CashflowOS abandon-cart recovery: source of truth for "started checkout but
-- did not pay". A row is upserted (by email) when someone completes step 1 of
-- /cashflowos; the Stripe webhook stamps paid_at on payment; a cron emails the
-- unpaid ones once (recovery_email_sent_at) after a delay. Accessed only via the
-- service-role client, so RLS-on with no policies locks it to server routes.
create table if not exists public.cashflowos_leads (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  phone text,
  name text,
  ghl_contact_id text,
  stripe_session_id text,
  started_at timestamptz not null default now(),
  paid_at timestamptz,
  recovery_email_sent_at timestamptz,
  created_at timestamptz not null default now()
);

-- Partial index: the cron's hot query is "unpaid, unchased, started before X".
create index if not exists cashflowos_leads_recovery_idx
  on public.cashflowos_leads (started_at)
  where paid_at is null and recovery_email_sent_at is null;

-- The webhook stamps paid_at by matching the Stripe session id.
create index if not exists cashflowos_leads_session_idx
  on public.cashflowos_leads (stripe_session_id);

alter table public.cashflowos_leads enable row level security;
