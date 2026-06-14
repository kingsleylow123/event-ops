-- Receipt emails (bank-reconciliation flow): stamp when an attendee's payment
-- receipt was emailed so re-running reconciliation never double-sends.
alter table attendees add column if not exists receipt_sent_at timestamptz;
