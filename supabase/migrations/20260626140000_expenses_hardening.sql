-- Expenses hardening migration — Phase 1 AI Bookkeeper audit must-fixes.
-- DO NOT apply to production — create only; Kingsley applies manually.
--
-- Run AFTER 20260626130000_expenses_receipt_fields.sql

-- 1. Drop the existing NOT NULL + FK, then re-add as nullable with ON DELETE SET NULL.
--    This means deleting an event UN-LINKS expenses instead of destroying tax records.
do $$ begin
  -- Drop the existing FK (default name = expenses_event_id_fkey).
  -- Safe to run twice: the inner block catches "constraint does not exist".
  alter table expenses drop constraint if exists expenses_event_id_fkey;
exception when undefined_object then null;
end $$;

-- Drop NOT NULL on event_id (null = unassigned / overhead expense).
alter table expenses alter column event_id drop not null;

-- Re-add FK as ON DELETE SET NULL.
alter table expenses
  add constraint expenses_event_id_fkey
    foreign key (event_id) references events(id) on delete set null;

comment on column expenses.event_id is
  'Event this expense belongs to. NULL = unassigned / overhead — allowed intentionally '
  'so deleting an event does not destroy tax records (ON DELETE SET NULL).';

-- 2. New audit/bookkeeping columns (all nullable — zero impact on existing rows).

alter table expenses
  add column if not exists receipt_date     date,
  add column if not exists receipt_url      text,
  add column if not exists receipt_fingerprint text,
  add column if not exists approved_by      text,
  add column if not exists approved_at      timestamptz,
  add column if not exists payment_source   text;

comment on column expenses.receipt_date         is 'Date printed on the receipt (YYYY-MM-DD). Used as the Bukku bill date for correct period posting.';
comment on column expenses.receipt_url          is 'Public or signed URL of the receipt image stored in Supabase Storage bucket "receipts". Appended to the Bukku bill description since Bukku cannot attach images.';
comment on column expenses.receipt_fingerprint  is 'SHA-256 of normalized(vendor)|receipt_date|amount_cents — cross-channel duplicate guard. Only dedups within EventOps; does not cover human-converted Bukku Shoebox bills.';
comment on column expenses.approved_by          is 'Telegram user id or name who typed YES to confirm the booking.';
comment on column expenses.approved_at          is 'Timestamp of the YES confirmation.';
comment on column expenses.payment_source       is 'How this expense was paid, e.g. "company_card", "personal_reimbursement", "petty_cash".';

-- 3. Unique partial index: prevents duplicate fingerprints while allowing NULL rows.
create unique index if not exists expenses_receipt_fingerprint_key
  on expenses (receipt_fingerprint)
  where receipt_fingerprint is not null;
