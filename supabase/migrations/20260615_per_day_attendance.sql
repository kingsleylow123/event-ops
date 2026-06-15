-- Per-day attendance for multi-day events (e.g. GLCC, 20-21 June).
-- Splits the single `attendance_confirmed` boolean into day-specific flags so
-- the team can tell "showed up Day 1 but not Day 2" apart from "no-show".
--
-- `attendance_confirmed` is kept and auto-mirrored = (day1 OR day2), so all
-- existing code that reads it (digest, no-shows, floor-plan live arrivals,
-- survey eligibility) keeps working unchanged on single-day events.

alter table attendees
  add column if not exists day1_attended boolean not null default false,
  add column if not exists day2_attended boolean not null default false;

-- Backfill: any existing "attended" record becomes Day 1 attended.
update attendees set day1_attended = true
where attendance_confirmed = true and day1_attended = false and day2_attended = false;

-- Trigger keeps attendance_confirmed = (day1 OR day2) for any write to the
-- per-day columns, so downstream readers don't need to change.
create or replace function sync_attendance_confirmed()
returns trigger as $$
begin
  new.attendance_confirmed := coalesce(new.day1_attended, false) or coalesce(new.day2_attended, false);
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_sync_attendance_confirmed on attendees;
create trigger trg_sync_attendance_confirmed
  before insert or update of day1_attended, day2_attended on attendees
  for each row execute function sync_attendance_confirmed();
