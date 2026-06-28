-- Funnel Command Center: optional manual "hand-raisers" count per event.
-- At a 1-day workshop, the team pitches the 2-day class one-to-many; this is the
-- number who physically stood up / raised their hand (not in any other table).
-- The funnel uses it to compute the seat->2-day "close on hand-raisers" rate.
-- Nullable: when unset the funnel omits that sub-metric rather than faking a proxy.
alter table public.events add column if not exists hand_raisers integer;
