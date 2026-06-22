-- Cal.com → pipeline auto-sync: extend deal_leads to store booked-call detail.
-- All additive + nullable (non-breaking for existing back-table capture rows).
alter table deal_leads
  add column if not exists client_email text,
  add column if not exists call_scheduled_at timestamptz,
  add column if not exists meeting_url text,
  add column if not exists cal_booking_uid text,
  add column if not exists source text default 'capture',
  add column if not exists ghl_contact_id text,
  add column if not exists ghl_opportunity_id text;

-- Idempotent key for the Cal.com sync. Partial so the many capture rows (NULL
-- uid) are unaffected; the sync does select-then-write, this is the race guard.
create unique index if not exists deal_leads_cal_booking_uid_key
  on deal_leads (cal_booking_uid) where cal_booking_uid is not null;

comment on column deal_leads.cal_booking_uid is 'Cal.com booking uid - idempotent key for the Cal.com auto-sync';
comment on column deal_leads.source is 'Origin of the deal lead: capture (back-table) | calcom | manual';
