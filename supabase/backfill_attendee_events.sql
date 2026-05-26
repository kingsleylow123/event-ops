-- One-time backfill: re-attribute existing attendees to the correct event by price tier.
-- Run after applying 20260525212759_add_paid_at_to_attendees.sql.
-- The next Stripe sync will overwrite paid_at with real Stripe payment times.
--
-- June 1 amounts: 249, 297, 347, 497, 597, 697
-- May 16 amounts (unique to May 16): 97, 159, 397
-- RM 297 appears in BOTH events (Early Bird VIP at both). For ambiguous rows,
-- we route by created_at: rows created on/after 2026-05-17 go to June 1,
-- rows created before that go to May 16.

with may_event as (
  select id from events where date::date < '2026-06-01' order by date desc limit 1
),
june_event as (
  select id from events where date::date >= '2026-06-01' order by date asc limit 1
)
-- Unambiguous June 1 amounts → June 1
update attendees set event_id = (select id from june_event)
where payment_amount in (249, 347, 497, 597, 697);

-- Unambiguous May 16 amounts → May 16
with may_event as (
  select id from events where date::date < '2026-06-01' order by date desc limit 1
)
update attendees set event_id = (select id from may_event)
where payment_amount in (97, 159, 397);

-- Ambiguous RM 297 → resolve by created_at
with may_event as (
  select id from events where date::date < '2026-06-01' order by date desc limit 1
),
june_event as (
  select id from events where date::date >= '2026-06-01' order by date asc limit 1
)
update attendees set event_id = case
  when created_at >= '2026-05-17'::timestamptz then (select id from june_event)
  else (select id from may_event)
end
where payment_amount = 297;

-- Fix ticket_type based on the canonical Stripe product list for 1st June:
--   RM 249 → [General]               standard_general
--   RM 297 → [General] Early Bird    early_bird_general
--   RM 347 → [GENERAL]               standard_general
--   RM 497 → [VIP]                   standard_vip
--   RM 597 → [VIP] Early Bird        early_bird_vip
--   RM 697 → [VIP]                   standard_vip
update attendees set ticket_type = 'standard_general'   where payment_amount in (249, 347);
update attendees set ticket_type = 'early_bird_general' where payment_amount = 297;
update attendees set ticket_type = 'standard_vip'       where payment_amount in (497, 697);
update attendees set ticket_type = 'early_bird_vip'     where payment_amount = 597;

-- Fallback fill for paid_at (Stripe sync will overwrite with real session.created)
update attendees set paid_at = created_at where paid_at is null;
