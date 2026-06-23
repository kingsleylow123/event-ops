-- Auto-track facilitator payouts into the financials: each facilitator_payouts
-- row mirrors into an `expenses` row (category 'Facilitator Payout') so it flows
-- into P&L, Finance dashboard, and Month-End automatically — the same hook Claims
-- uses. expense_id links the two so we update/delete in lockstep (no double-count).
alter table public.facilitator_payouts
  add column if not exists expense_id uuid references expenses(id) on delete set null;
