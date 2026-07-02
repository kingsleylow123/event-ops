-- AI C-Suite v2 — close the loops (audit council, Jul 2 2026). Additive only.
-- 1) Rulings get a lifecycle (pending → done/dismissed/snoozed) so the next
--    sitting knows what Kingsley acted on (Telegram buttons + dashboard PATCH).
-- 2) Ingested runs get provenance (source) + a body fingerprint for idempotency
--    (a double-POST from the harness must not double-Telegram).
-- 3) Head memory rows get provenance too (app | ingest).

alter table public.c_suite_decisions
  add column if not exists status text not null default 'pending',   -- pending | done | dismissed | snoozed
  add column if not exists decided_by text,
  add column if not exists decided_at timestamptz;

alter table public.c_suite_runs
  add column if not exists source text,                              -- app | ingest
  add column if not exists fingerprint text;
create unique index if not exists c_suite_runs_fingerprint_idx
  on public.c_suite_runs (fingerprint) where fingerprint is not null;

alter table public.c_suite_head_memory
  add column if not exists source text;
