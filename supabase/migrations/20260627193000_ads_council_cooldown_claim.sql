-- Atomic per-entity cooldown claim for the ads council executor. Serialises two
-- distinct approved actions targeting the SAME entity so only one can write.
-- Returns true iff THIS caller took the lock (no active cooldown existed).
-- Applied live to project hxqpcicdrjgdjabkwlfu on 2026-06-27.
create or replace function public.ads_claim_cooldown(p_entity_id text, p_hours int, p_action text)
returns boolean
language plpgsql
as $$
declare
  rows int;
begin
  update public.ads_cooldowns
     set last_action_type = p_action,
         last_action_at = now(),
         cooldown_until = now() + make_interval(hours => p_hours)
   where entity_id = p_entity_id
     and (cooldown_until is null or cooldown_until <= now());
  get diagnostics rows = row_count;
  if rows > 0 then
    return true;
  end if;

  begin
    insert into public.ads_cooldowns (entity_id, last_action_type, last_action_at, cooldown_until)
    values (p_entity_id, p_action, now(), now() + make_interval(hours => p_hours));
    return true;
  exception when unique_violation then
    return false;
  end;
end;
$$;
