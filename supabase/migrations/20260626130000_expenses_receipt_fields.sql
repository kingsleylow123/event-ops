-- Add receipt-booking fields to expenses.
-- All columns are nullable / have safe defaults so existing rows are unaffected.
-- DO NOT apply to production — this migration is created only, not applied.

alter table expenses
  add column if not exists vendor       text,
  add column if not exists source       text default 'manual',
  add column if not exists tg_file_id   text,
  add column if not exists ai_confidence numeric;

comment on column expenses.vendor        is 'Vendor/supplier name extracted from receipt by Claude vision';
comment on column expenses.source        is 'Origin of the expense row: manual | jarvis_receipt';
comment on column expenses.tg_file_id    is 'Telegram file_id of the receipt photo (no Supabase Storage needed)';
comment on column expenses.ai_confidence is 'Claude vision confidence score 0..1 for the extracted receipt data';
