-- Phase 1 (deterministic event routing): each event carries the pricing tier
-- that is currently "live" so the new EventOps-generated /register checkout shows
-- General vs VIP at the right price, and the webhook attaches the payment to the
-- EXACT event via session metadata (no more "soonest upcoming" guess).
alter table public.events
  add column if not exists pricing_tier text not null default 'standard';

-- Keep it to the three sellable tiers (free stays manual via Attendees).
alter table public.events
  drop constraint if exists events_pricing_tier_check;
alter table public.events
  add constraint events_pricing_tier_check
  check (pricing_tier in ('super_early_bird', 'early_bird', 'standard'));

comment on column public.events.pricing_tier is
  'Active sales tier for /register: super_early_bird | early_bird | standard. /register shows General vs VIP at this tier; /api/stripe/checkout server-pins the price from it.';
