-- Manual finance entries: other income/expenses & adjustments that aren't
-- captured by attendees (ticket revenue), the expenses table, or affiliate
-- payouts. The /finance P&L combines all four sources.
-- event_id NULL = business-wide entry (counts toward the All-events total only).
create table if not exists finance_entries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete cascade,
  type text not null check (type in ('income', 'expense')),
  category text not null default 'Other',
  description text not null,
  amount numeric(12, 2) not null check (amount >= 0),
  entry_date date not null default current_date,
  created_at timestamptz not null default now()
);

create index if not exists finance_entries_event_id_idx on finance_entries (event_id);
create index if not exists finance_entries_type_idx on finance_entries (type);

-- RLS on (matches attendees/expenses/affiliate_payouts). The app reads/writes
-- this table only via the service-role key in /api/finance, which bypasses RLS,
-- so no policies are needed — this just blocks anon-key access to finance data.
alter table finance_entries enable row level security;
