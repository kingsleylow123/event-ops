-- Link affiliate payouts and expenses to their Bukku records, so syncs are
-- idempotent (a row already carrying a bukku_bill_id is skipped on re-push).
-- Both text — Bukku returns string transaction IDs.

alter table affiliate_payouts add column if not exists bukku_bill_id text;
alter table expenses          add column if not exists bukku_bill_id text;

create index if not exists affiliate_payouts_bukku_bill_id_idx on affiliate_payouts (bukku_bill_id) where bukku_bill_id is not null;
create index if not exists expenses_bukku_bill_id_idx          on expenses (bukku_bill_id)          where bukku_bill_id is not null;
