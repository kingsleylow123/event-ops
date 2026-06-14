-- Deposit tracker: people who paid a partial deposit toward an event and owe a
-- balance by a due date. balance = total_amount - deposit_paid (computed in app).
--   status 'partial' = balance outstanding · 'paid' = settled · 'cancelled'
-- "Overdue" is derived (status='partial' AND due_date < today), not stored.
-- Jarvis chases overdue / due-soon balances in the daily digest.
create table if not exists deposits (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  name text not null,
  phone text,
  total_amount numeric(12, 2) not null check (total_amount >= 0),
  deposit_paid numeric(12, 2) not null default 0 check (deposit_paid >= 0),
  due_date date,
  status text not null default 'partial' check (status in ('partial', 'paid', 'cancelled')),
  notes text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists deposits_event_id_idx on deposits (event_id);
create index if not exists deposits_due_date_idx on deposits (due_date);

-- RLS on (matches attendees/expenses/finance_entries/claims). The app reads/writes
-- this table only via the service-role key in /api/deposits, which bypasses RLS.
alter table deposits enable row level security;
