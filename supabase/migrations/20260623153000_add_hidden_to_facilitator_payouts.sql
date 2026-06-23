-- Let the payout list be curated: facilitators auto-populate from the event's
-- attendee roster, but not everyone is a payee (volunteers, people under another
-- lead's headcount, etc.). `hidden` removes a facilitator from the payout list
-- for that event without touching the attendance record. Reversible.
alter table public.facilitator_payouts
  add column if not exists hidden boolean not null default false;
