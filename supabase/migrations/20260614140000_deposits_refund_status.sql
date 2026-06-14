-- Rename the deposit "cancelled" status to "refunded" and link a refund to the
-- finance entry it creates (so the refund flows into revenue and is reversible).
alter table deposits drop constraint if exists deposits_status_check;
update deposits set status = 'refunded' where status = 'cancelled';
alter table deposits add constraint deposits_status_check
  check (status in ('partial', 'paid', 'refunded'));

alter table deposits add column if not exists refund_entry_id uuid
  references finance_entries(id) on delete set null;
