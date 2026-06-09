-- Add Bukku linkage columns to events.
-- bukku_contact_id: the Bukku contact representing the client booking the event
-- bukku_income_id : the Bukku banking-income (or invoice) row for the event revenue
-- Both are text — Bukku returns string IDs.

alter table events add column if not exists bukku_contact_id text;
alter table events add column if not exists bukku_income_id  text;

create index if not exists events_bukku_income_id_idx on events (bukku_income_id) where bukku_income_id is not null;
