-- Expense claims / reimbursements submitted against an event. Unlike `expenses`
-- (already-settled costs), a claim has a claimant and a lifecycle:
--   pending → approved → paid   (or rejected)
-- When a claim is marked paid, the app creates a matching `expenses` row and
-- links it via expense_id, so paid claims flow into the Finance P&L and Bukku.
-- Jarvis follows up on pending claims via the daily digest + anomaly cron.
create table if not exists claims (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  claimant_name text not null,
  claimant_phone text,
  description text not null,
  category text not null default 'Reimbursement',
  amount numeric(12, 2) not null check (amount >= 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'paid', 'rejected')),
  expense_id uuid references expenses(id) on delete set null,
  submitted_at timestamptz not null default now(),
  paid_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists claims_event_id_idx on claims (event_id);
create index if not exists claims_status_idx on claims (status);

-- RLS on (matches attendees/expenses/finance_entries). The app reads/writes this
-- table only via the service-role key in /api/claims, which bypasses RLS, so no
-- policies are needed — this just blocks anon-key access to claim data.
alter table claims enable row level security;
