-- Abandon-cart → closer pipeline: link each chased lead to its deal_leads card
-- (created by the recovery cron, source 'abandoned_checkout'), and track the
-- second recovery touch ("doors close soon" morning email).
alter table public.cashflowos_leads
  add column if not exists deal_lead_id uuid,
  add column if not exists recovery_email2_sent_at timestamptz;
