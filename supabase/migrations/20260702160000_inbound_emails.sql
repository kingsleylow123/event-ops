-- Inbound replies to support@cmoaiconsulting.com, mirrored into EventOps by a
-- Cloudflare Email Worker (forward to Gmail first, then POST here). Each row is
-- one received email, matched (best-effort) to the sender's CRM record.
-- Server-only access via the service-role client → RLS-on with no policies.
create table if not exists public.inbound_emails (
  id uuid primary key default gen_random_uuid(),
  from_email text not null,
  to_email text,
  subject text,
  body_text text,
  matched_type text check (matched_type in ('attendee','cashflowos_lead','lead')),
  matched_id uuid,
  received_at timestamptz not null default now()
);

-- Hot queries: "latest replies" and "replies from X".
create index if not exists inbound_emails_received_idx on public.inbound_emails (received_at desc);
create index if not exists inbound_emails_from_idx on public.inbound_emails (from_email);

alter table public.inbound_emails enable row level security;
