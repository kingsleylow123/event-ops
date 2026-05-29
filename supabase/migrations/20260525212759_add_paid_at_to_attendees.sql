alter table attendees add column if not exists paid_at timestamptz;
create index if not exists attendees_paid_at_idx on attendees (paid_at);
